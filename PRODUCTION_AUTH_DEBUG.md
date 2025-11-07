# 🔍 Production Authentication Debugging Guide

## Major Problem Identified

### Issue: `access_token` was being stripped from login response

**Root Cause:**
The `ApiClient` was parsing the login response but **not including `access_token`** in the returned data object.

**Backend returns:**
```json
{
  "message": "Login successful",
  "client": {...},
  "access_token": "eyJhbGc..."
}
```

**ApiClient was returning:**
```typescript
{
  success: true,
  data: {
    message: data.message,
    client: data.client
    // ❌ access_token was MISSING!
  }
}
```

**Result:** Token never stored in localStorage → No Authorization header sent → 401 Unauthorized

---

## Fix Applied ✅

**File:** `email-frontend/src/api/ApiClient.ts`

**Changed:**
```typescript
// Now includes access_token
data: {
  message: data.message,
  client: data.client,
  access_token: data.access_token // ✅ FIXED
}
```

---

## Why It Worked Locally But Not in Production

### Local Development:
- ✅ Same origin (localhost:3001 → localhost:3000)
- ✅ Cookies work reliably
- ✅ Even without Authorization header, cookies were sufficient

### Production:
- ❌ Cross-origin (Vercel → Render)
- ❌ Cookies may not work reliably
- ❌ No Authorization header (token not stored)
- ❌ Result: 401 Unauthorized

---

## Verification Steps

### 1. Check Token Storage (After Login)
Open browser console on production site:
```javascript
localStorage.getItem('access_token')
```
**Expected:** Should return a JWT token string

### 2. Check Authorization Header
Open Network tab → Find any API request → Check Headers:
```
Authorization: Bearer eyJhbGc...
```
**Expected:** Should see Authorization header with token

### 3. Check Cookies
Open Application/Storage tab → Cookies:
```
access_token: eyJhbGc...
```
**Expected:** Should see httpOnly cookie (if cookies work)

---

## Debugging Checklist

If still getting 401 after fix:

- [ ] **Token stored?** Check `localStorage.getItem('access_token')`
- [ ] **Header sent?** Check Network tab → Request Headers → Authorization
- [ ] **Cookie set?** Check Application tab → Cookies → access_token
- [ ] **Backend receives?** Check backend logs for token extraction
- [ ] **CORS correct?** Verify frontend URL in backend CORS config
- [ ] **HTTPS?** Ensure both Vercel and Render use HTTPS

---

## Common Issues

### Issue 1: Token Not Stored
**Symptom:** `localStorage.getItem('access_token')` returns `null`

**Causes:**
- Login response doesn't include `access_token`
- ApiClient stripping `access_token` (FIXED)
- localStorage blocked/disabled

**Fix:** Ensure backend returns `access_token` in login response

### Issue 2: Token Not Sent
**Symptom:** No `Authorization` header in requests

**Causes:**
- Token not in localStorage
- `getAuthToken()` returning null
- Headers not being set

**Fix:** Verify token is stored and `getAuthToken()` works

### Issue 3: Backend Not Reading Token
**Symptom:** 401 even with Authorization header

**Causes:**
- JWT strategy not checking Authorization header (FIXED)
- Invalid token format
- Token expired
- Wrong JWT_SECRET

**Fix:** Verify JWT strategy checks both methods

---

## Next Steps

1. **Deploy the fix** to Vercel
2. **Test login** on production
3. **Verify token storage:** `localStorage.getItem('access_token')`
4. **Check Network tab** for Authorization header
5. **Test API calls** - should work now

---

## Summary

✅ **Fixed:** ApiClient now includes `access_token` in login response
✅ **Fixed:** Token stored in localStorage
✅ **Fixed:** Authorization header sent with requests
✅ **Fixed:** Backend accepts both cookies and Authorization header

**The major problem was:** Token was being stripped from the response, so it never got stored, so Authorization header was never sent.

