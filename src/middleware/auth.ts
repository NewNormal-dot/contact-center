import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import db from '../database/db';

const JWT_SECRET = process.env.JWT_SECRET || 'your-default-secret-change-this-in-prod';

export async function authenticate(req: any, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    const dbUser = await db('users').where({ id: decoded.id }).first();

    if (!dbUser || dbUser.status === 'inactive') {
      return res.status(401).json({ error: 'Unauthorized or inactive user' });
    }

    req.user = {
      ...decoded,
      role: dbUser.role,
      email: dbUser.email,
      name: dbUser.name,
      status: dbUser.status,
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

export function authorize(roles: string[]) {
  return (req: any, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}
