<?php

namespace App\Rules;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Http\UploadedFile;

/**
 * The uploaded file can still be read. Server antivirus may delete a dangerous upload (e.g. a hidden web shell)
 * the moment it arrives; this answers "refused" instead of crashing while checking its type. Use with `bail`
 * before `mimes`.
 */
class ReadableUpload implements ValidationRule
{
    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if ($value instanceof UploadedFile && ! $this->canRead((string) $value->getPathname())) {
            $fail('This file could not be read. It may have been blocked as unsafe. Try another file.');
        }
    }

    /** Actually open and read it: antivirus can lock a file that still "exists" and looks readable. */
    private function canRead(string $path): bool
    {
        $handle = @fopen($path, 'rb');
        if ($handle === false) {
            return false;
        }
        $read = @fread($handle, 1);
        fclose($handle);

        return $read !== false;
    }
}
