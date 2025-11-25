# SMS Configuration Guide

## 🆓 Free Option: Console SMS (Development/Testing)

**No setup required!** If you don't have Twilio credits, you can use the free Console SMS service that logs OTP codes to your backend console.

### Enable Console SMS Mode

Simply add this to your `.env` file:
```env
SMS_PROVIDER=console
```

**OR** just don't set Twilio credentials - the system will automatically use Console SMS if Twilio credentials are missing.

### How It Works

- OTP codes are logged to your backend console
- You can copy the code from the console logs
- Perfect for development and testing
- **100% Free** - no credits needed!

### Example Console Output
```
================================================================================
📱 SMS MESSAGE (Console Mode - Not Actually Sent)
================================================================================
To: +923117243792
Message: Your verification code is 123456. It expires in 10 minutes.
Message SID: console_1234567890_abc123
================================================================================

📱 SMS OTP (Copy this code):
   123456
```

---

## Twilio SMS Configuration (Production)

If you want to actually send SMS messages, configure Twilio below.

## Required Environment Variables

To fix the "SMS service is not properly configured" error, you need to set the following environment variables in your `.env` file:

### 1. Twilio Credentials (Required)
```env
TWILIO_ACCOUNT_SID=your_account_sid_here
TWILIO_AUTH_TOKEN=your_auth_token_here
```

### 2. Twilio Sender Configuration (Required - choose one)

**Option A: Use a Twilio Phone Number**
```env
TWILIO_FROM_NUMBER=+1234567890
```

**Option B: Use a Messaging Service (Recommended for production)**
```env
MESSAGING_SERVICE_SID=your_messaging_service_sid_here
```

## How to Get Your Twilio Credentials

1. **Sign up/Login to Twilio**: Go to https://www.twilio.com/
2. **Get Account SID and Auth Token**:
   - Log into your Twilio Console
   - Go to Dashboard
   - Your **Account SID** is displayed on the dashboard
   - Click "Show" next to Auth Token to reveal your **Auth Token**
   - Copy both values

3. **Get a Phone Number or Messaging Service**:
   
   **For Phone Number (Option A)**:
   - Go to Phone Numbers → Manage → Buy a number
   - Purchase a phone number
   - Copy the number in E.164 format (e.g., `+1234567890`)
   
   **For Messaging Service (Option B - Recommended)**:
   - Go to Messaging → Services
   - Create a new Messaging Service or use an existing one
   - Copy the **Service SID** (starts with `MG...`)

## Example .env Configuration

```env
# Twilio Configuration
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_FROM_NUMBER=+12766640243

# OR use Messaging Service instead:
# MESSAGING_SERVICE_SID=MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Optional: Test override (sends all SMS to this number for testing)
# SMS_TEST_TO=+1234567890
```

## Verification Steps

### For Console SMS (Free):
1. **Add to `.env`**: `SMS_PROVIDER=console`
2. **Restart your backend server**
3. **Check backend logs** - you should see:
   - `📱 Using Console SMS Service (free - logs to console)`
   - OTP codes will be logged when you request them

### For Twilio SMS:
1. **Add Twilio credentials to `.env`** (see above)
2. **Restart your backend server**
3. **Check backend logs** - you should see:
   - `✅ Twilio credentials loaded`
   - `Using From Number: +12766640243` (or your configured number)
4. **Try adding a phone number** - the OTP should be sent successfully

## Troubleshooting

### Error: "Twilio authentication failed"
- **Check**: Your `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` are correct
- **Solution**: Re-copy them from Twilio Console (they're case-sensitive)

### Error: "Twilio sender is not configured"
- **Check**: Either `TWILIO_FROM_NUMBER` or `MESSAGING_SERVICE_SID` is set
- **Solution**: Add one of these to your `.env` file

### Error: "Invalid phone number format"
- **Check**: Phone numbers must be in E.164 format (e.g., `+923117243792`)
- **Solution**: Ensure the number starts with `+` followed by country code

## Notes

- **Messaging Service** is recommended for production as it provides better deliverability and allows multiple phone numbers
- **Phone Number** is simpler for development/testing
- Make sure your Twilio account has sufficient balance for sending SMS
- Twilio trial accounts have limitations on which numbers you can send to

