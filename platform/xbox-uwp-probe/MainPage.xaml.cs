using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;

namespace Giera.XboxProbe
{
    public sealed partial class MainPage : Page
    {
        private readonly PackagedAssetResolver resolver = new PackagedAssetResolver();

        public MainPage()
        {
            InitializeComponent();
            Loaded += MainPage_Loaded;
        }

        private void MainPage_Loaded(object sender, RoutedEventArgs e)
        {
            Loaded -= MainPage_Loaded;
            var probeUri = ProbeView.BuildLocalStreamUri("giera-xbox-probe", "/probe.html");
            ProbeView.NavigateToLocalStreamUri(probeUri, resolver);
        }
    }
}
