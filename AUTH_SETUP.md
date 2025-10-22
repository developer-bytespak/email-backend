# Authentication System Setup

This document describes the JWT-based authentication system implemented for the email backend.

## Overview

The authentication system provides secure login/signup functionality using JWT tokens stored in HTTP-only cookies for enhanced security.

## Features

- **JWT Token Authentication**: Secure token-based authentication
- **HTTP-Only Cookies**: Tokens stored in secure, HTTP-only cookies
- **Password Hashing**: Bcrypt for secure password storage
- **Input Validation**: DTO validation for all auth endpoints
- **CORS Support**: Configured for frontend integration

## API Endpoints

### Authentication Endpoints

#### POST `/auth/signup`
Register a new client.

**Request Body:**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "password123",
  "phone": "+1234567890",
  "city": "New York",
  "country": "USA",
  "address": "123 Main St"
}
```

**Response:**
```json
{
  "id": 1,
  "name": "John Doe",
  "email": "john@example.com",
  "phone": "+1234567890",
  "city": "New York",
  "country": "USA",
  "address": "123 Main St",
  "createdAt": "2024-01-01T00:00:00.000Z"
}
```

#### POST `/auth/login`
Login with email and password.

**Request Body:**
```json
{
  "email": "john@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "message": "Login successful",
  "client": {
    "id": 1,
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "+1234567890",
    "city": "New York",
    "country": "USA",
    "address": "123 Main St"
  }
}
```

**Note:** The JWT token is automatically set as an HTTP-only cookie named `access_token`.

#### POST `/auth/logout`
Logout and clear the authentication cookie.

**Response:**
```json
{
  "message": "Logout successful"
}
```

#### GET `/auth/profile`
Get the current authenticated client's profile.

**Headers Required:** Cookie with `access_token`

**Response:**
```json
{
  "id": 1,
  "name": "John Doe",
  "email": "john@example.com",
  "phone": "+1234567890",
  "city": "New York",
  "country": "USA",
  "address": "123 Main St",
  "createdAt": "2024-01-01T00:00:00.000Z"
}
```

#### GET `/auth/verify`
Verify if the current token is valid.

**Headers Required:** Cookie with `access_token`

**Response:**
```json
{
  "valid": true,
  "client": {
    "id": 1,
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "+1234567890",
    "city": "New York",
    "country": "USA",
    "address": "123 Main St",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

## Security Features

### JWT Configuration
- **Secret Key**: Configurable via `JWT_SECRET` environment variable
- **Expiration**: 24 hours
- **Algorithm**: HS256

### Cookie Configuration
- **HTTP-Only**: Prevents XSS attacks
- **Secure**: Only sent over HTTPS in production
- **SameSite**: Strict mode for CSRF protection
- **Max Age**: 24 hours

### Password Security
- **Hashing**: Bcrypt with salt rounds of 10
- **Validation**: Minimum 6 characters required

## Environment Variables

Create a `.env` file in the backend root with:

```env
# Database
DATABASE_URL="postgresql://username:password@localhost:5432/email_db"
DIRECT_URL="postgresql://username:password@localhost:5432/email_db"

# JWT Configuration
JWT_SECRET="your-super-secret-jwt-key-change-this-in-production"

# Server Configuration
PORT=3001
NODE_ENV=development

# Frontend URL for CORS
FRONTEND_URL="http://localhost:3000"
```

## Frontend Integration

### Login Request Example
```javascript
const login = async (email, password) => {
  const response = await fetch('http://localhost:3001/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include', // Important for cookies
    body: JSON.stringify({ email, password }),
  });
  
  return response.json();
};
```

### Making Authenticated Requests
```javascript
const getProfile = async () => {
  const response = await fetch('http://localhost:3001/auth/profile', {
    method: 'GET',
    credentials: 'include', // Important for cookies
  });
  
  return response.json();
};
```

### Logout Request
```javascript
const logout = async () => {
  const response = await fetch('http://localhost:3001/auth/logout', {
    method: 'POST',
    credentials: 'include', // Important for cookies
  });
  
  return response.json();
};
```

## Database Schema

The authentication system uses the existing `Client` model in Prisma:

```prisma
model Client {
  id           Int              @id @default(autoincrement())
  name         String
  email        String           @unique
  phone        String
  city         String
  country      String
  address      String
  hashPassword String
  createdAt    DateTime         @default(now())
  updatedAt    DateTime         @default(now()) @updatedAt
  // ... other relations
}
```

## Error Handling

The system handles various error scenarios:

- **409 Conflict**: Email already exists during signup
- **401 Unauthorized**: Invalid credentials during login
- **400 Bad Request**: Validation errors for input data
- **500 Internal Server Error**: Server-side errors

## Testing the API

You can test the authentication endpoints using tools like Postman or curl:

### Signup Test
```bash
curl -X POST http://localhost:3001/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User",
    "email": "test@example.com",
    "password": "password123",
    "phone": "+1234567890",
    "city": "Test City",
    "country": "Test Country",
    "address": "123 Test St"
  }'
```

### Login Test
```bash
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d '{
    "email": "test@example.com",
    "password": "password123"
  }'
```

### Profile Test (with cookie)
```bash
curl -X GET http://localhost:3001/auth/profile \
  -b cookies.txt
```

## Security Best Practices

1. **Environment Variables**: Always use environment variables for secrets
2. **HTTPS**: Use HTTPS in production
3. **Token Expiration**: Tokens expire after 24 hours
4. **Password Requirements**: Implement strong password policies
5. **Rate Limiting**: Consider implementing rate limiting for auth endpoints
6. **Logging**: Monitor authentication attempts for security

## Troubleshooting

### Common Issues

1. **CORS Errors**: Ensure `credentials: 'include'` is set in frontend requests
2. **Cookie Not Set**: Check CORS configuration and cookie settings
3. **Token Expired**: Implement token refresh logic if needed
4. **Database Connection**: Ensure Prisma is properly configured

### Debug Mode

Set `NODE_ENV=development` to enable detailed error messages during development.
