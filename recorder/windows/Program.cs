// Timber recorder — Windows implementation (WASAPI loopback).
//
// Captures the default output device's render mix (whatever the machine is
// playing) via NAudio's WasapiLoopbackCapture and streams it to the Timber app
// over a local WebSocket. Speaks the protocol documented in ../README.md; the
// Linux implementation (../linux) is a drop-in replacement on the same port.
//
// WASAPI loopback hands us the device's mix format as-is — typically 32-bit
// float at the device rate — so the `hello` message announces the real format
// (usually f32le) and the app builds its WAV header from that. No resampling
// happens here; the helper's job is to move bytes, not interpret them.
//
// Run with `dotnet run` (the dev script does this). Loopback-only bind.

using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using NAudio.Wave;
using TimberRecorder; // MediaControl (SMTC) — top-level statements sit in the
                      // global namespace, so this isn't implicit.

int port = int.TryParse(Environment.GetEnvironmentVariable("RECORDER_PORT"), out var p)
    ? p
    : 8790;

var listener = new HttpListener();
listener.Prefixes.Add($"http://127.0.0.1:{port}/");
listener.Start();
Console.WriteLine($"[recorder] windows/wasapi listening on ws://127.0.0.1:{port}");

while (true)
{
    var context = await listener.GetContextAsync();
    if (!context.Request.IsWebSocketRequest)
    {
        // Plain-HTTP probe, mirroring the Linux implementation.
        var probe = Encoding.UTF8.GetBytes("{\"name\":\"timber-recorder\",\"os\":\"windows\"}");
        context.Response.ContentType = "application/json";
        await context.Response.OutputStream.WriteAsync(probe);
        context.Response.Close();
        continue;
    }

    var ws = (await context.AcceptWebSocketAsync(subProtocol: null)).WebSocket;
    _ = HandleConnection(ws); // one task per connection; capture state is per-connection
}

static async Task HandleConnection(WebSocket ws)
{
    // WebSocket.SendAsync forbids concurrent sends, and audio arrives on the
    // capture callback thread while events originate here — serialize with a
    // semaphore rather than a queue (frames are small and frequent).
    var sendLock = new SemaphoreSlim(1, 1);
    WasapiLoopbackCapture? capture = null;
    var stopping = false;

    async Task Send(WebSocketMessageType type, byte[] payload)
    {
        await sendLock.WaitAsync();
        try
        {
            if (ws.State == WebSocketState.Open)
                await ws.SendAsync(payload, type, endOfMessage: true, CancellationToken.None);
        }
        finally
        {
            sendLock.Release();
        }
    }

    Task SendJson(object obj) =>
        Send(WebSocketMessageType.Text, JsonSerializer.SerializeToUtf8Bytes(obj));

    Task Fail(string message)
    {
        Console.Error.WriteLine($"[recorder] {message}");
        return SendJson(new { @event = "error", message });
    }

    async Task StartCapture()
    {
        if (capture != null)
        {
            await Fail("A capture is already running.");
            return;
        }
        Console.WriteLine("[recorder] capture start");
        stopping = false;

        // Default render device's loopback. The wave format is the device mix
        // format; announce it so the client can interpret the raw frames.
        var cap = new WasapiLoopbackCapture();
        capture = cap;
        var fmt = cap.WaveFormat;
        string encoding = fmt.Encoding switch
        {
            WaveFormatEncoding.IeeeFloat => "f32le",
            WaveFormatEncoding.Pcm when fmt.BitsPerSample == 16 => "s16le",
            _ => throw new NotSupportedException($"Unexpected device mix format: {fmt}"),
        };
        // hello already went out on connect with a provisional format; re-announce
        // with the real device format so the client always has the right one
        // before any audio arrives.
        await SendJson(new
        {
            @event = "hello",
            name = "windows · wasapi loopback",
            format = new { encoding, sampleRate = fmt.SampleRate, channels = fmt.Channels },
        });

        var started = false;
        cap.DataAvailable += (_, e) =>
        {
            if (e.BytesRecorded == 0) return;
            var chunk = new byte[e.BytesRecorded];
            Array.Copy(e.Buffer, chunk, e.BytesRecorded);
            var first = !started;
            started = true;
            // Fire-and-forget is fine here: Send serializes internally, and a
            // dead socket makes Send a no-op.
            _ = Task.Run(async () =>
            {
                if (first) await SendJson(new { @event = "started" });
                await Send(WebSocketMessageType.Binary, chunk);
            });
        };
        cap.RecordingStopped += (_, e) =>
        {
            capture = null;
            cap.Dispose();
            Console.WriteLine("[recorder] capture ended");
            _ = Task.Run(async () =>
            {
                await SendJson(new { @event = "ended" });
                if (!stopping)
                    await Fail(e.Exception?.Message ?? "Capture stopped unexpectedly.");
            });
        };
        cap.StartRecording();
    }

    Task StopCapture()
    {
        if (capture == null) return Fail("No capture is running.");
        stopping = true;
        capture.StopRecording(); // RecordingStopped sends `ended`
        return Task.CompletedTask;
    }

    // Media control (../README.md, "Media control"): stateless one-shots against
    // whatever is on SMTC — deliberately independent of the capture state above,
    // so a skip can never disturb a take in progress. Failures come back as
    // ok:false on the SAME id rather than through Fail(), because `error` means
    // "the capture is dead" and a refused skip isn't that.
    async Task HandleMedia(JsonElement msg)
    {
        var id = msg.TryGetProperty("id", out var idEl) ? idEl.GetInt32() : 0;
        var action = msg.TryGetProperty("action", out var aEl) ? aEl.GetString() ?? "" : "";
        var delta = msg.TryGetProperty("deltaSeconds", out var dEl) && dEl.ValueKind == JsonValueKind.Number
            ? dEl.GetDouble()
            : 0;
        try
        {
            await MediaControl.Run(action, delta);
            Console.WriteLine($"[recorder] media '{action}' ok");
            await SendJson(new { @event = "media-result", id, ok = true });
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[recorder] media '{action}' failed: {ex.Message}");
            await SendJson(new { @event = "media-result", id, ok = false, message = ex.Message });
        }
    }

    // Provisional hello so a client that never starts a capture still learns
    // who it's talking to; StartCapture re-sends it with the live device format.
    await SendJson(new
    {
        @event = "hello",
        name = "windows · wasapi loopback",
        format = new { encoding = "f32le", sampleRate = 48000, channels = 2 },
    });

    var buffer = new byte[4096];
    try
    {
        while (ws.State == WebSocketState.Open)
        {
            var result = await ws.ReceiveAsync(buffer, CancellationToken.None);
            if (result.MessageType == WebSocketMessageType.Close) break;
            if (result.MessageType != WebSocketMessageType.Text) continue;

            var text = Encoding.UTF8.GetString(buffer, 0, result.Count);
            JsonElement msg;
            string? cmd;
            try
            {
                msg = JsonDocument.Parse(text).RootElement.Clone();
                cmd = msg.GetProperty("cmd").GetString();
            }
            catch
            {
                await Fail("Malformed command (expected JSON).");
                continue;
            }
            if (cmd == "start") await StartCapture();
            else if (cmd == "stop") await StopCapture();
            // Not awaited: a media command must never hold up the receive loop
            // (a `stop` arriving mid-take can't wait on a stalled seek).
            else if (cmd == "media") _ = HandleMedia(msg);
            else await Fail($"Unknown command: {text}");
        }
    }
    catch (WebSocketException)
    {
        // Client vanished — treated the same as a clean close below.
    }
    finally
    {
        stopping = true;
        capture?.StopRecording();
        if (ws.State == WebSocketState.Open)
            await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, null, CancellationToken.None);
        ws.Dispose();
    }
}
