using System;
using System.Threading.Tasks;
using Windows.Storage;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Media.Animation;
using Windows.UI.Xaml.Navigation;

namespace Giera.Uwp
{
    public sealed partial class MainPage : Page
    {
        const string StartUrl = "https://giera.tail5d39b4.ts.net/index.html";
        const string BootToken = "boot-ready";
        const string LogFile = "boot-log.txt";

        readonly DispatcherTimer splashTimeout = new DispatcherTimer();
        bool splashHidden;

        public MainPage()
        {
            InitializeComponent();
            splashTimeout.Interval = TimeSpan.FromSeconds(45);
            splashTimeout.Tick += OnSplashTimeout;
            Loaded += OnLoaded;
            NavigationCacheMode = NavigationCacheMode.Required;
        }

        async void OnLoaded(object sender, RoutedEventArgs e)
        {
            splashTimeout.Start();
            await LogAsync("page loaded");
            try
            {
                Environment.SetEnvironmentVariable("WEBVIEW2_DEFAULT_BACKGROUND_COLOR", "FF0B1020");
                Environment.SetEnvironmentVariable(
                    "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
                    "--autoplay-policy=no-user-gesture-required");
                await LogAsync("env set");
                await GameView.EnsureCoreWebView2Async();
                await LogAsync("webview2 ensured");
            }
            catch (Exception ex)
            {
                splashTimeout.Stop();
                SplashProgress.IsIndeterminate = false;
                SplashStatus.Text = "WebView2 runtime unavailable. Install the Edge WebView2 runtime.";
                await LogAsync("ensure-webview2 failed: " + ex.Message);
                return;
            }

            var core = GameView.CoreWebView2;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.AreDevToolsEnabled = true;
            core.Settings.IsZoomControlEnabled = false;
            core.Settings.IsSwipeNavigationEnabled = false;

            core.WebMessageReceived += OnWebMessageReceived;
            GameView.NavigationCompleted += OnNavigationCompleted;

            await core.AddScriptToExecuteOnDocumentCreatedAsync(
                "window.external = window.external || {};" +
                "window.external.notify = function (m) { window.chrome.webview.postMessage(String(m)); };");

            await LogAsync("webview2 " + core.Environment.BrowserVersionString);
            core.Navigate(StartUrl);
        }

        void OnSplashTimeout(object sender, object e)
        {
            splashTimeout.Stop();
            _ = LogAsync("splash timeout without " + BootToken);
            HideSplash();
        }

        async void OnNavigationCompleted(Microsoft.UI.Xaml.Controls.WebView2 sender, Microsoft.Web.WebView2.Core.CoreWebView2NavigationCompletedEventArgs args)
        {
            if (!args.IsSuccess)
            {
                splashTimeout.Stop();
                SplashProgress.IsIndeterminate = false;
                SplashStatus.Text = "navigation failed: " + args.WebErrorStatus;
                await LogAsync("navigation failed: " + args.WebErrorStatus);
                return;
            }

            await LogAsync("navigation completed");
            await LogAsync("engine " + await EvalAsync(
                "JSON.stringify({" +
                "webgl2:(function(){try{return !!document.createElement('canvas').getContext('webgl2')}catch(e){return false}})()," +
                "ua:navigator.userAgent})"));
        }

        async void OnWebMessageReceived(Microsoft.Web.WebView2.Core.CoreWebView2 sender, Microsoft.Web.WebView2.Core.CoreWebView2WebMessageReceivedEventArgs args)
        {
            string message;
            try
            {
                message = args.TryGetWebMessageAsString() ?? "";
            }
            catch (Exception ex)
            {
                message = "unreadable: " + ex.Message;
            }

            if (message == BootToken)
            {
                splashTimeout.Stop();
                HideSplash();
                GameView.Focus(FocusState.Programmatic);
                await LogAsync("boot-ready");
                await SnapshotAsync("after-boot");
                await Task.Delay(6000);
                await SnapshotAsync("after-6s");
                return;
            }

            await LogAsync("message: " + message);
        }

        async Task SnapshotAsync(string label)
        {
            var state = await EvalAsync(
                "JSON.stringify({" +
                "ready:!!(window.__GIERA__&&window.__GIERA__.ready)," +
                "music:(window.__GIERA__&&window.__GIERA__.audio&&window.__GIERA__.audio.playingMusic)||null," +
                "audioState:(window.__GIERA__&&window.__GIERA__.audio&&window.__GIERA__.audio.context&&window.__GIERA__.audio.context.state)||null," +
                "fps:(window.__GIERA__&&window.__GIERA__.stats&&window.__GIERA__.stats.fps)||0," +
                "menu:!!document.querySelector('.launch-menu')})");
            await LogAsync(label + " " + state);
        }

        async Task<string> EvalAsync(string script)
        {
            try
            {
                return await GameView.CoreWebView2.ExecuteScriptAsync(script);
            }
            catch (Exception ex)
            {
                return "eval-error: " + ex.Message;
            }
        }

        void HideSplash()
        {
            if (splashHidden)
            {
                return;
            }
            splashHidden = true;

            var fade = new DoubleAnimation
            {
                To = 0,
                Duration = new Duration(TimeSpan.FromMilliseconds(450)),
                EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut }
            };
            Storyboard.SetTarget(fade, SplashLayer);
            Storyboard.SetTargetProperty(fade, "Opacity");

            var storyboard = new Storyboard();
            storyboard.Children.Add(fade);
            storyboard.Completed += (s, e) => SplashLayer.Visibility = Visibility.Collapsed;
            storyboard.Begin();
        }

        static async Task LogAsync(string line)
        {
            try
            {
                var file = await ApplicationData.Current.LocalFolder.CreateFileAsync(
                    LogFile, CreationCollisionOption.OpenIfExists);
                await FileIO.AppendTextAsync(file, DateTimeOffset.Now.ToString("HH:mm:ss.fff") + " " + line + "\n");
            }
            catch
            {
            }
        }

        protected override void OnNavigatedFrom(NavigationEventArgs e)
        {
            splashTimeout.Stop();
            base.OnNavigatedFrom(e);
        }
    }
}