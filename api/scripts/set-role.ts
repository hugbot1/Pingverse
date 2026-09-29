// Usage (run from the api/ folder):
//   npm run set-role -- <username> <admin|user>
//
// This is the ONLY way to make someone an admin/owner. It edits the local
// database directly, so it requires access to the machine running the API -
// there is no web endpoint that can grant or remove the admin role.
//
// Making someone an admin also marks the account approved, so you can
// bootstrap the very first admin: register normally, then run this.
import { env } from '../src/config/env.js';
import { closeDb } from '../src/db/index.js';
import { UserModel } from '../src/models/userModel.js';

const [, , username, role] = process.argv;

if (!username || !['admin', 'user'].includes(role)) {
  console.error('Usage: npm run set-role -- <username> <admin|user>');
  process.exit(1);
}

const user = UserModel.findByUsername(username);
if (!user) {
  console.error(`No account named "${username}" exists in ${env.databasePath}`);
  closeDb();
  process.exit(1);
}

UserModel.setRole(username, role);
if (role === 'admin') UserModel.setStatus(username, 'approved');

console.log(`"${username}" is now: role=${role}${role === 'admin' ? ', status=approved' : ''}`);
closeDb();
