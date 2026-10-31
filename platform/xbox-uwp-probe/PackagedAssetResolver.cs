using System;
using System.IO;
using System.Runtime.InteropServices.WindowsRuntime;
using System.Threading.Tasks;
using Windows.Foundation;
using Windows.Storage;
using Windows.Storage.Streams;
using Windows.Web;

namespace Giera.XboxProbe
{
    public sealed class PackagedAssetResolver : IUriToStreamResolver
    {
        private static readonly char[] InvalidFileNameChars = Path.GetInvalidFileNameChars();
        private static readonly char[] PathSeparators = { '/' };
        public IAsyncOperation<IInputStream> UriToStreamAsync(Uri uri)
        {
            if (uri == null || !string.Equals(uri.Scheme, "ms-local-stream", StringComparison.OrdinalIgnoreCase))
            {
                throw new FileNotFoundException("Only packaged local resources are allowed.");
            }

            return ResolveAsync(uri).AsAsyncOperation();
        }

        private static async Task<IInputStream> ResolveAsync(Uri uri)
        {
            var decodedPath = Uri.UnescapeDataString(uri.AbsolutePath);
            var segments = decodedPath.Split(PathSeparators, StringSplitOptions.RemoveEmptyEntries);
            if (segments.Length == 0)
            {
                throw new FileNotFoundException("Invalid packaged resource path.");
            }

            foreach (var segment in segments)
            {
                if (segment == "." || segment == ".." || segment.IndexOfAny(InvalidFileNameChars) >= 0)
                {
                    throw new FileNotFoundException("Invalid packaged resource path.");
                }
            }

            var fileUri = new Uri("ms-appx:///Assets" + uri.AbsolutePath);
            var file = await StorageFile.GetFileFromApplicationUriAsync(fileUri);
            return await file.OpenAsync(FileAccessMode.Read);
        }
    }
}
