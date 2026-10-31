using System;
using System.IO;
using System.Runtime.InteropServices.WindowsRuntime;
using System.Threading.Tasks;
using Windows.Foundation;
using Windows.Storage;
using Windows.Storage.Streams;
using Windows.UI.Xaml.Controls;
using Windows.Web;

namespace Giera.XboxProbe
{
    public sealed partial class MainPage : Page
    {
        static readonly Uri StreamRoot = new Uri("ms-local-stream://giera.local/");

        public MainPage()
        {
            InitializeComponent();
            ProbeView.ScriptNotify += OnScriptNotify;
            ProbeView.NavigationCompleted += OnNavigationCompleted;
            Loaded += (s, e) =>
            {
                ProbeView.NavigateToLocalStreamUri(new Uri(StreamRoot, "Assets/probe.html"), new PackagedAssetResolver());
                _ = ReportTimeoutAsync();
            };
        }

        static async Task ReportTimeoutAsync()
        {
            await Task.Delay(TimeSpan.FromSeconds(45));
            if (!s_reported)
            {
                await WriteResultAsync("{\"probe\":\"no-scriptnotify\",\"note\":\"page loaded but never posted a result\"}");
            }
        }

        static bool s_reported;

        void OnScriptNotify(object sender, NotifyEventArgs e)
        {
            s_reported = true;
            Status.Text = e.Value;
            _ = WriteResultAsync(e.Value);
        }

        static async Task WriteResultAsync(string json)
        {
            try
            {
                var file = await ApplicationData.Current.LocalFolder.CreateFileAsync("probe-result.json", CreationCollisionOption.ReplaceExisting);
                await FileIO.WriteTextAsync(file, json);
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine("probe result write failed: " + ex.Message);
            }
        }

        void OnNavigationCompleted(WebView sender, WebViewNavigationCompletedEventArgs e)
        {
            if (!e.IsSuccess)
            {
                s_reported = true;
                var detail = "navigation failed: " + e.WebErrorStatus + " " + e.Uri;
                Status.Text = detail;
                _ = WriteResultAsync("{\"probe\":\"navigation-failed\",\"detail\":\"" + e.WebErrorStatus + "\",\"uri\":\"" + e.Uri + "\"}");
            }
        }
    }

    public sealed class PackagedAssetResolver : IUriToStreamResolver
    {
        public IAsyncOperation<IInputStream> UriToStreamAsync(Uri uri)
        {
            return OpenAsync(uri).AsAsyncOperation();
        }

        static async Task<IInputStream> OpenAsync(Uri uri)
        {
            var relative = uri.AbsolutePath.TrimStart('/');
            if (relative.Length == 0)
            {
                relative = "Assets/probe.html";
            }
            var file = await StorageFile.GetFileFromApplicationUriAsync(new Uri("ms-appx:///" + relative));
            return await file.OpenSequentialReadAsync();
        }
    }
}