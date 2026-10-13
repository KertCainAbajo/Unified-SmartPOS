<?php

namespace App\Exceptions;

use Illuminate\Http\JsonResponse;
use RuntimeException;

/**
 * A request that is well-formed but violates a business rule (e.g. insufficient stock).
 * Rendered as HTTP 422 with a stable machine-readable code.
 */
class BusinessRuleException extends RuntimeException
{
    /**
     * @param  array<string, list<string>>  $errors
     */
    public function __construct(
        string $message,
        public readonly string $errorCode = 'BUSINESS_RULE_VIOLATION',
        public readonly array $errors = [],
        public readonly int $status = 422,
    ) {
        parent::__construct($message);
    }

    public function render(): JsonResponse
    {
        $body = ['message' => $this->getMessage(), 'code' => $this->errorCode];

        if ($this->errors !== []) {
            $body['errors'] = $this->errors;
        }

        return response()->json($body, $this->status);
    }
}
