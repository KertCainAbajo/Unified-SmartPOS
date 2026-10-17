<?php

namespace App\Services\Catalog;

use App\Models\Product;
use App\Services\AuditLogger;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\Response;

/**
 * Product photos. Every upload is decoded and re-encoded as a JPEG no larger than MAX_SIDE pixels, so stored
 * files are small, carry no camera metadata, and are always a real image whatever was uploaded.
 */
class ProductImageService
{
    public const DISK = 'public';

    private const MAX_SIDE = 900;

    public function __construct(private readonly AuditLogger $audit) {}

    /** @param  UploadedFile|string  $source  an upload, or the path of a local image file (used by seeders) */
    public function store(Product $product, UploadedFile|string $source): Product
    {
        $bytes = $source instanceof UploadedFile ? $source->get() : @file_get_contents($source);
        $jpeg = $this->normalize((string) $bytes);

        $path = "products/{$product->tenant_id}/{$product->id}-".Str::lower(Str::random(10)).'.jpg';
        Storage::disk(self::DISK)->put($path, $jpeg);

        $old = $product->image_path;
        $product->forceFill(['image_path' => $path])->save();
        if ($old) {
            Storage::disk(self::DISK)->delete($old);
        }
        $this->audit->log('product.image_updated', $product, ['image_path' => $old], ['image_path' => $path]);

        return $product;
    }

    public function remove(Product $product): Product
    {
        if ($old = $product->image_path) {
            $product->forceFill(['image_path' => null])->save();
            Storage::disk(self::DISK)->delete($old);
            $this->audit->log('product.image_removed', $product, ['image_path' => $old], ['image_path' => null]);
        }

        return $product;
    }

    /** The stored photo, cacheable by browsers; the URL changes whenever the photo does. */
    public function response(Product $product): Response
    {
        $disk = Storage::disk(self::DISK);
        abort_unless($product->image_path && $disk->exists($product->image_path), 404);

        return response($disk->get($product->image_path), 200, [
            'Content-Type' => 'image/jpeg',
            'Cache-Control' => 'public, max-age=604800, immutable',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    /** Short fingerprint of the current photo, appended to image URLs to bust caches. */
    public static function version(Product $product): string
    {
        return substr(md5((string) $product->image_path), 0, 10);
    }

    private function normalize(string $bytes): string
    {
        $image = $bytes !== '' ? @imagecreatefromstring($bytes) : false;
        if (! $image) {
            throw ValidationException::withMessages(['image' => 'This file could not be read as an image.']);
        }

        $width = imagesx($image);
        $height = imagesy($image);
        $scale = min(1, self::MAX_SIDE / max($width, $height));
        $targetWidth = max(1, (int) round($width * $scale));
        $targetHeight = max(1, (int) round($height * $scale));

        // Paint onto white so transparent PNGs/WebPs do not turn black as JPEGs.
        $canvas = imagecreatetruecolor($targetWidth, $targetHeight);
        imagefill($canvas, 0, 0, imagecolorallocate($canvas, 255, 255, 255));
        imagecopyresampled($canvas, $image, 0, 0, 0, 0, $targetWidth, $targetHeight, $width, $height);

        ob_start();
        imagejpeg($canvas, null, 84);

        return (string) ob_get_clean();
    }
}
