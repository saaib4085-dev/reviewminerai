# Turning on Google sign-up

The app's code is ready. These steps connect it to your Google and Supabase accounts.
You need: your live site address (e.g. `https://review-miner.pages.dev`) and your Supabase
project reference (the `abcd1234` in `https://abcd1234.supabase.co`, under Project Settings → API).

## 1. Google Cloud: create the project and consent screen
1. Go to https://console.cloud.google.com, create a project (e.g. "Review Miner").
2. Open **Google Auth Platform** (search "OAuth consent" if you don't see it) → **Get started**.
3. **Branding**: App name `Review Miner`, your support email, developer contact email.
   Under **Authorised domains** add your site's domain (e.g. `review-miner.pages.dev` or `yourdomain.com`)
   and `YOUR-PROJECT.supabase.co`.
4. **Audience**: choose **External**.
5. **Data access**: keep the default scopes (`openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`). Nothing else is needed.

## 2. Google Cloud: create the sign-in client
1. Google Auth Platform → **Clients** → **Create client**.
2. Application type: **Web application**. Name: `Review Miner web`.
3. **Authorised JavaScript origins**: `https://YOUR-SITE` (add your custom domain too if you have one).
4. **Authorised redirect URIs**: `https://YOUR-PROJECT.supabase.co/auth/v1/callback`
5. Create, then copy the **Client ID** and **Client secret**.

## 3. Supabase: switch Google on
1. Supabase dashboard → **Authentication → Sign In / Providers → Google**.
2. Turn it on, paste the Client ID and Client secret, **Save**.
3. **Authentication → URL Configuration**:
   - Site URL: `https://YOUR-SITE`
   - Redirect URLs: add `https://YOUR-SITE/**` (and your custom domain if you use one).

## 4. Go live
While the Google app is in **Testing**, only the test users you list can sign up.
Google Auth Platform → **Audience** → **Publish app** to open it to everyone.
With only the basic scopes above this is usually instant. If you upload a logo, Google may ask to
verify your branding first, which can take a few days. You can launch without a logo and add it later.

## 5. Test it
1. Open your site in a private/incognito window and click **Sign up with Google**.
2. Pick a Google account. You should land back in the app, signed in, with **15 credits**.
3. In Supabase → **Authentication → Users** you'll see the new user, and in **Table Editor → profiles** their 15 credits.

## Common problems
- **"redirect_uri_mismatch"**: the redirect URI in step 2.4 must match exactly, including `https://` and `/auth/v1/callback`.
- **"Google sign-up isn't switched on yet"** in the app: Google isn't enabled in Supabase (step 3.2).
- **You land on the wrong site or `localhost`**: check the Site URL and Redirect URLs in step 3.3.
- **"Access blocked: this app's request is invalid"**: the consent screen isn't finished (step 1).
- **Only some people can sign in**: the Google app is still in Testing (step 4).

## Optional: show your own domain on Google's screen
Google's account picker says "to continue to YOUR-PROJECT.supabase.co". To show your own domain instead,
set up a Supabase custom domain (a paid add-on), then use `https://auth.yourdomain.com/auth/v1/callback`
as the redirect URI in step 2.4.

## Button logo
The button uses a simple "G" badge as a placeholder. Google's branding rules ask sign-in buttons to use the
official Google "G" logo, which you can download from Google's "Sign in with Google" branding guidelines page
and drop into `src/components/GoogleButton.tsx`.
