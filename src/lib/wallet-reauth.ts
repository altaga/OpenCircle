/**
 * wallet-reauth — WebAuthn re-authentication before destructive local actions.
 *
 * Used as a gate on `forgetCredential`: the user must prove they still hold
 * the same authenticator that registered the wallet before the local
 * credential is wiped. The challenge is generated client-side and never
 * leaves the device; a failure here means the user cancelled or the
 * authenticator was unavailable, in either case the wipe is blocked.
 *
 * The credential `id` is base64url-encoded in storage (WebAuthn standard);
 * `PublicKeyCredential.id` requires a BufferSource, so it has to be decoded
 * back to bytes for `allowCredentials`.
 */
import type { WebAuthnCredential } from '@circle-fin/modular-wallets-core'

/** Decode a base64url string (no padding) to a Uint8Array. */
function base64UrlToBytes(s: string): Uint8Array {
  // Normalize to standard base64 and pad to a multiple of 4.
  let b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  while (b64.length % 4) b64 += '='
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * Re-authenticate with the *exact* passkey that registered the wallet.
 *
 * Returns `true` on a successful assertion, `false` on any failure path
 * (user cancel, authenticator unavailable, no match). The caller should
 * treat `false` as "do not proceed with the destructive action".
 *
 * The server does not see this challenge, so the re-auth proves possession
 * of the authenticator, not identity with any relying-party session.
 */
export async function reauthWithPasskey(cred: WebAuthnCredential): Promise<boolean> {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  if (!window.PublicKeyCredential || !navigator.credentials?.get) return false
  if (!cred?.id) return false

  // 16 bytes of entropy is plenty for a single-shot, never-resent challenge.
  const challenge = new Uint8Array(16)
  crypto.getRandomValues(challenge)

  let credentialId: Uint8Array
  try {
    credentialId = base64UrlToBytes(cred.id)
  } catch {
    return false
  }

  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        rpId: window.location.hostname,
        allowCredentials: [{ id: credentialId, type: 'public-key' }],
        userVerification: 'required',
        timeout: 60_000,
      },
      // mediation suppresses the silent auto-fill flow; we want an explicit
      // gesture every time, not a quiet re-auth on each page load.
      mediation: 'required',
    } as CredentialRequestOptions)
    return assertion !== null
  } catch {
    // NotAllowedError = user cancelled. SecurityError / NotSupportedError =
    // authenticator unavailable. Any failure path means "do not wipe".
    return false
  }
}
