import { hash, verify, type Algorithm, type Options } from '@node-rs/argon2';
import { env } from '@/config/env';
import { logger } from '@/config/logger';

/**
 * Password hashing with Argon2id.
 *
 * Why Argon2id over bcrypt: it is memory-hard, so an attacker with GPUs or
 * ASICs gains far less than they do against bcrypt's fixed 4 KiB working set.
 * It won the Password Hashing Competition and is the OWASP recommendation for
 * new applications.
 *
 * Why `@node-rs/argon2` rather than the `argon2` package: the latter compiles
 * from C++ through node-gyp, so a clean `npm install` needs Python and a build
 * toolchain and fails outright without them. `@node-rs/argon2` is Rust and ships
 * prebuilt binaries for every platform this template targets, including
 * linux-musl for Alpine images. A starter that cannot be installed is not a
 * starter, and the security properties are identical.
 *
 * Parameters come from env so they can be tuned per environment. Argon2 encodes
 * them inside the hash string, so raising them later does not invalidate
 * existing hashes — old passwords keep verifying at their original cost.
 */

/**
 * Argon2id. Stated explicitly rather than relying on the library default: the
 * choice of variant is a security decision and should be visible in our code,
 * not inherited silently from a dependency.
 *
 * The numeric literal (rather than `Algorithm.Argon2id`) is required because the
 * library declares Algorithm as a `const enum`, which cannot be read at runtime
 * under `isolatedModules`.
 */
const ARGON2ID = 2 as Algorithm;

const hashOptions: Options = {
  algorithm: ARGON2ID,
  memoryCost: env.ARGON2_MEMORY_COST,
  timeCost: env.ARGON2_TIME_COST,
  parallelism: env.ARGON2_PARALLELISM,
};

export async function hashPassword(plainPassword: string): Promise<string> {
  // A random salt is generated and embedded automatically; never supply one.
  return hash(plainPassword, hashOptions);
}

/**
 * Verifies a password against a stored hash.
 *
 * Returns false rather than throwing on a malformed hash, so a corrupted row is
 * indistinguishable from a wrong password to the caller — that difference is
 * exactly the kind of signal an attacker probes for.
 *
 * Note: the cost parameters are read from the hash string itself, so a password
 * hashed under older settings still verifies correctly. If you later want to
 * upgrade hashes in place, compare the `m=`/`t=`/`p=` values in the stored
 * string against the current config after a successful login and rehash when
 * they are lower.
 */
export async function comparePassword(plainPassword: string, hashString: string): Promise<boolean> {
  try {
    return await verify(hashString, plainPassword, hashOptions);
  } catch (error) {
    logger.error({ err: error }, 'password verification failed');
    return false;
  }
}
