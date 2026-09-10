import { generateSync, NobleCryptoPlugin, ScureBase32Plugin } from 'otplib';
process.stderr.write(String(generateSync({ secret: process.argv[2], crypto: new NobleCryptoPlugin(), base32: new ScureBase32Plugin() })) + '\n');
