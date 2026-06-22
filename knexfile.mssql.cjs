const path = require('path');
const { TYPES } = require('tedious');

module.exports = {
  production: {
    client: 'mssql',
    connection: {
      server: process.env.DB_SERVER,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      port: Number(process.env.DB_PORT || 1433),
      options: {
        encrypt: true,
        trustServerCertificate: false,
        enableArithAbort: true,
        mapBinding: (value) => {
          if (typeof value === 'string') return { type: TYPES.NVarChar, value };
          if (typeof value === 'number') return { type: Number.isInteger(value) ? TYPES.Int : TYPES.Float, value };
          if (typeof value === 'boolean') return { type: TYPES.Bit, value };
          if (value instanceof Date) return { type: TYPES.DateTime2, value };
          return undefined;
        },
      },
    },
    migrations: {
      directory: path.join(process.cwd(), 'src/database/migrations'),
    },
    seeds: {
      directory: path.join(process.cwd(), 'src/database/seeds'),
    },
    pool: {
      min: 0,
      max: 10,
    },
  },
};
