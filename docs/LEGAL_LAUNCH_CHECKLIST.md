# Legal and public-content launch checklist

The application now has linked, explicitly marked draft policy pages. The drafts are not ready to present as final legal documents until the operator and each participating business supply the items below and obtain any review they need.

## Platform operator

Set these public build-time values in `web/.env` before building the web app:

- `VITE_PLATFORM_LEGAL_NAME`
- `VITE_PLATFORM_SUPPORT_EMAIL`
- `VITE_PLATFORM_PRIVACY_EMAIL`
- `VITE_PLATFORM_ADDRESS`

Complete the platform privacy notice with retention periods, deletion process, hosting and mail subprocessors, and a privacy request process. Complete the terms with actual service, support, availability, fees, termination, and data export/deletion terms.

## Each business using the shop or careers pages

- Publish its registered business identity and working contact details in Settings.
- Add a customer refund, exchange, cancellation, and return policy and tell customers how to contact the store. The internal POS refund approval window is not a customer refund policy.
- Provide an appropriate privacy notice for customer accounts, orders, delivery location data, and job applications. Set retention periods and an internal process for privacy requests and applicant documents.
- Confirm that product photos and logos may be used. Demo image attributions are kept in `database/seeders/demo-images/CREDITS.md` and in the shop footer.

## Deployment review

- Check the final host for injected analytics, advertising, session replay, or monitoring scripts; update the privacy and cookie notices before enabling any that collect visitor data.
- Confirm the current BIR permit/accreditation and receipt requirements for each business and deployment. This software does not claim BIR accreditation.
- Review the privacy notice and consent wording with the relevant privacy lead or counsel. NPC materials describe the transparency information expected when people are informed about personal data processing: [NPC consent guidelines](https://privacy.gov.ph/wp-content/uploads/2023/11/NPC-Circular-No.-2023-04_Guidelines-on-Consent_07Nov2023.pdf).
- Confirm current BIR requirements with the business's RDO or BIR guidance: [BIR registration requirements](https://www.bir.gov.ph/registration-requirements-details).

