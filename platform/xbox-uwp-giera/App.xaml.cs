using System;
using System.IO;
using Windows.ApplicationModel;
using Windows.ApplicationModel.Activation;
using Windows.Storage;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Navigation;

namespace Giera.Uwp
{
    sealed partial class App : Application
    {
        public App()
        {
            InitializeComponent();
            UnhandledException += OnUnhandledException;
            Suspending += OnSuspending;
            Log("app-ctor");
        }

        internal static void Log(string line)
        {
            try
            {
                File.AppendAllText(
                    Path.Combine(ApplicationData.Current.LocalFolder.Path, "boot-log.txt"),
                    DateTimeOffset.Now.ToString("HH:mm:ss.fff") + " " + line + Environment.NewLine);
            }
            catch
            {
            }
        }

        void OnUnhandledException(object sender, Windows.UI.Xaml.UnhandledExceptionEventArgs e)
        {
            Log("unhandled: " + e.Message + " | " + e.Exception);
        }

        protected override void OnLaunched(LaunchActivatedEventArgs e)
        {
            Log("on-launched");
            var rootFrame = Window.Current.Content as Frame;
            if (rootFrame == null)
            {
                rootFrame = new Frame();
                rootFrame.NavigationFailed += OnNavigationFailed;
                Window.Current.Content = rootFrame;
            }

            if (e.PrelaunchActivated == false)
            {
                if (rootFrame.Content == null)
                {
                    rootFrame.Navigate(typeof(MainPage), e.Arguments);
                    Log("navigated");
                }
                Window.Current.Activate();
                Log("activated");
            }
        }

        void OnNavigationFailed(object sender, NavigationFailedEventArgs e)
        {
            Log("navigation failed: " + e.SourcePageType.FullName);
            throw new Exception("Failed to load Page " + e.SourcePageType.FullName);
        }

        private void OnSuspending(object sender, SuspendingEventArgs e)
        {
            var deferral = e.SuspendingOperation.GetDeferral();
            deferral.Complete();
        }
    }
}