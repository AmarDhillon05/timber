// SMTC media control — the Windows answer to the Linux sidecar's MPRIS core
// (../linux/media.js). Wraps GlobalSystemMediaTransportControls (GSMTC), the
// same machinery behind the media-key overlay, so we can drive whatever app is
// currently playing (Spotify, a browser tab, …) — exactly the sources the
// WASAPI loopback capture records.
//
// This is how the phone remote's transport buttons reach the OS: relay → app →
// recorder sidecar → here. It used to live in the Electron main process behind
// a native WinRT binding (@nodert-win10-rs4); moving it here matches Linux,
// drops that dependency, and means media control works in a plain browser too.
//
// WinRT is reachable from C# through the SDK projections the csproj's
// net8.0-windows10.0.19041.0 target enables — no extra package needed.

using Windows.Media.Control;

namespace TimberRecorder;

public static class MediaControl
{
    // SMTC only does ABSOLUTE seeks, so a relative skip means: read the current
    // timeline position, add the delta, clamp to the track. (MPRIS gets this
    // for free — its Seek is already relative.)
    private const long TicksPerSecond = 10_000_000; // WinRT ticks are 100 ns

    private static GlobalSystemMediaTransportControlsSessionManager? _manager;

    // The manager is requested once and cached; it tracks the current session
    // on its own as the user switches apps.
    private static async Task<GlobalSystemMediaTransportControlsSession> CurrentSession()
    {
        _manager ??= await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
        return _manager.GetCurrentSession()
            ?? throw new InvalidOperationException(
                "No media player is running (no active media session to control).");
    }

    /// <summary>
    /// Execute one media action. <paramref name="deltaSeconds"/> only applies to
    /// "seekBy". Throws if the action is unknown, if nothing is playing, or if
    /// the player refused the command — the caller turns that into an
    /// ok:false media-result.
    /// </summary>
    public static async Task Run(string action, double deltaSeconds)
    {
        var session = await CurrentSession();

        // Each TryXxxAsync reports whether the app actually accepted the
        // command (not every player supports every transport control), so a
        // false is a real failure the remote should hear about.
        bool ok = action switch
        {
            "play" => await session.TryPlayAsync(),
            "pause" => await session.TryPauseAsync(),
            "stop" => await session.TryStopAsync(),
            "toggle" => await session.TryTogglePlayPauseAsync(),
            "next" => await session.TrySkipNextAsync(),
            "rewind" => await session.TrySkipPreviousAsync(),
            "seekBy" => await SeekBy(session, deltaSeconds),
            _ => throw new ArgumentException($"Unknown media action: \"{action}\""),
        };

        if (!ok)
            throw new InvalidOperationException(
                $"The current player refused '{action}'.");
    }

    private static async Task<bool> SeekBy(
        GlobalSystemMediaTransportControlsSession session,
        double deltaSeconds)
    {
        if (double.IsNaN(deltaSeconds) || double.IsInfinity(deltaSeconds))
            throw new ArgumentException(
                $"seekBy needs a finite deltaSeconds (got {deltaSeconds}).");

        var timeline = session.GetTimelineProperties();
        long position = timeline.Position.Ticks;
        long end = timeline.EndTime.Ticks;

        long target = position + (long)Math.Round(deltaSeconds * TicksPerSecond);
        if (end > 0) target = Math.Min(target, end);
        target = Math.Max(0, target);

        return await session.TryChangePlaybackPositionAsync(target);
    }
}
