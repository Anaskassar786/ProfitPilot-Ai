# ProfitPilot App Recovery Guide

## Issue: App returns 404 or "There's no page at this address" in Shopify admin

### Root Cause

Using the URL `https://admin.shopify.com/oauth/install_custom_app?client_id=...`
to install an **embedded** app causes a conflict in Shopify's app installation
state. This URL is designed for **non-embedded custom apps only** and should
never be used for managed-install embedded apps like ProfitPilot.

After using this link, the app entry in the Shopify admin sidebar may disappear
and the app URL returns a 404 page.

### Recovery Steps

#### Step 1: Reinstall from the Partner Dashboard

1. Go to https://partners.shopify.com/ and log in
2. Navigate to **Apps** → **ProfitPilot** → **Distribution**
3. Click **"Install app"** and select your store (`commander-pilot`)
4. Confirm all requested OAuth scopes
5. Complete the installation

#### Step 2: Access the app from the correct URL

After reinstallation, access the app at:
```
https://admin.shopify.com/store/commander-pilot/apps/672a90634f619274ff139c12423c5883
```

Replace the API key with your app's API key if different.

#### Step 3: Hard refresh the embedded app

If the app still doesn't load after reinstallation:

1. Open your browser's developer tools (F12)
2. Go to **Application** → **Storage** → **Cookies**
3. Clear cookies for `admin.shopify.com`
4. Hard refresh (Ctrl+Shift+R / Cmd+Shift+R)
5. Re-navigate to the app from the Shopify admin sidebar under **Apps**

#### Step 4: Verify installation via the API

```bash
# Check if the store is registered and has an access token
curl "https://your-app.railway.app/shopify/status?shop=commander-pilot.myshopify.com"

# Expected response:
# {
#   "ok": true,
#   "status": {
#     "registered": true,
#     "shopDomain": "commander-pilot.myshopify.com",
#     "storeId": "store_...",
#     "hasToken": true,
#     "installUrl": "https://admin.shopify.com/store/commander-pilot/apps/672a90634f619274ff139c12423c5883"
#   }
# }
```

### Prevention

- **Never** use `https://admin.shopify.com/oauth/install_custom_app?client_id=...`
  for embedded apps. This link is only for custom (non-embedded) apps.
- Always install embedded apps through the Partner Dashboard → Distribution page.
- The correct app URL in Shopify admin follows the pattern:
  `https://admin.shopify.com/store/{store-name}/apps/{API_KEY}`

### Troubleshooting

**Q: The Partner Dashboard shows "App not installed" even after following these steps.**
A: This may be a cache issue. Try clearing browser cookies for partners.shopify.com
and try again. If the issue persists, the app may need to be re-registered.

**Q: The app loads but shows "No Shopify store context detected".**
A: This means the embedded-entry middleware couldn't find the tenant. Hard refresh
the app (clear cookies for admin.shopify.com and reload). The session cookie
should be set during the first app load.

**Q: Sync still returns 403 after reinstallation.**
A: The stored access token may have insufficient scopes. The app now passes
scopes during token exchange (fix in PR #17), but an old token needs to be
re-exchanged. Hard refresh the embedded app to force a new token exchange, or
ask the operator to delete the token from `shopify_tokens` in the database.