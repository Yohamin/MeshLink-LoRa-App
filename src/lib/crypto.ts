import {
  AESEncryptionKey,
  AESSealedData,
  CryptoDigestAlgorithm,
  CryptoEncoding,
  aesDecryptAsync,
  aesEncryptAsync,
  digestStringAsync,
} from "expo-crypto";

async function keyDigest(passphrase: string): Promise<string> {
  return digestStringAsync(
    CryptoDigestAlgorithm.SHA256,
    `LoRaMesh/v1/${passphrase}`,
    { encoding: CryptoEncoding.HEX },
  );
}

async function keyFromPassphrase(passphrase: string): Promise<AESEncryptionKey> {
  const digest = await keyDigest(passphrase);
  return AESEncryptionKey.import(digest, "hex") as Promise<AESEncryptionKey>;
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function networkKeyId(passphrase: string): Promise<string> {
  const digest = (await keyDigest(passphrase)).toUpperCase().slice(0, 12);
  return digest.match(/.{1,4}/g)?.join("-") ?? digest;
}

export async function testEncryptionRoundTrip(passphrase: string): Promise<boolean> {
  const expected = "MeshLink AES self-test";
  const encrypted = await encryptMessage(expected, passphrase);
  const decrypted = await decryptMessage(encrypted, passphrase);
  return decrypted === expected;
}

export async function encryptMessage(
  plainText: string,
  passphrase: string,
): Promise<string> {
  const key = await keyFromPassphrase(passphrase);
  const sealed = await aesEncryptAsync(new TextEncoder().encode(plainText), key);
  return sealed.combined("base64");
}

export async function decryptMessage(
  payload: string,
  passphrase: string,
): Promise<string> {
  const key = await keyFromPassphrase(passphrase);
  // expo-crypto's Android native method accepts ByteArray here even though
  // its public TypeScript API also advertises Base64 strings. Decode before
  // crossing the native bridge to avoid the "expected an Object" error.
  const sealed = AESSealedData.fromCombined(base64ToBytes(payload), {
    ivLength: 12,
    tagLength: 16,
  });
  const bytes = await aesDecryptAsync(sealed, key, { output: "bytes" });
  return new TextDecoder().decode(bytes);
}
