import knex from 'knex';
import config from '../../knexfile';

const environment = process.env.NODE_ENV || 'development';
const selectedConfig = config[environment];

if (!selectedConfig) {
  throw new Error(`No Knex configuration found for NODE_ENV=${environment}`);
}

const db = knex(selectedConfig);

export default db;