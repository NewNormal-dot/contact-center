const DEVELOPMENT_JWT_SECRET = 'your-default-secret-change-this-in-prod';

export function getJwtSecret() {
  if (process.env.JWT_SECRET) {
    return process.env.JWT_SECRET;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET is required in production');
  }

  return DEVELOPMENT_JWT_SECRET;
}
