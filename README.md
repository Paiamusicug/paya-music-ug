# Paya Music UG — website starter

A responsive music platform starter with public artist/listener accounts, MP3 submissions, admin moderation, streaming and downloads.

## Run it on a computer

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env`.
3. Set a long random `JWT_SECRET`, a private admin email and a strong admin password.
4. In this folder run:

   ```bash
   npm install
   npm start
   ```

5. Open `http://localhost:3000`.

## Included

- Responsive dark/gold Paya Music UG homepage
- Public account registration and sign-in
- MP3 uploads for registered users
- Uploads remain pending until an admin approves them
- Admin approval/rejection dashboard for songs and advertising campaigns
- Search approved tracks, stream and download
- Business advertising submissions with image/link, placement and campaign dates
- Admin-reviewed homepage advertising; only approved, in-date campaigns are shown
- Manual advertising pricing/payment workflow (no online payment processor yet)
- SQLite database and local upload storage for development

## Before publishing online

This is a development starter, not a production-hardened public service. Before launch:

- Deploy behind HTTPS.
- Use managed object storage for audio and a managed database with backups.
- Add email verification, password reset, account deletion and stronger session management.
- Add upload malware/content scanning, file signature validation, quotas, abuse reporting and moderation/audit logs.
- Add copyright ownership declarations, a takedown process, terms, privacy notice and community rules.
- Configure storage/CDN access so only approved songs can be streamed or downloaded.
- Set upload size limits and operational monitoring.
- Never publish `.env`, database files or private credentials.
- Review music licensing, copyright and privacy obligations for the countries where the platform operates.

The initial administrator is created from `ADMIN_EMAIL` and `ADMIN_PASSWORD` on first startup. Keep those credentials private. Registration creates artist-level accounts; users cannot grant themselves admin access.

## Important

The app currently accepts MP3 only for music. Advertising images are supplied as public HTTPS/HTTP image URLs. Businesses submit campaigns while signed in; admin approval is required before ads appear. This starter does not process advert payments, issue invoices, verify advertiser identity, or provide campaign analytics. Arrange pricing and payment manually until a payment and billing system is added. It also does not yet include royalty accounting, playlists, charts, editorial news, mobile apps or social sign-in.
