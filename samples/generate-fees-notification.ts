/**
 * Generate a sample fees notification email
 * Run with: npx tsx samples/generate-fees-notification.ts
 */
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { generateFeesNotificationEmail } from '../src/lib/fees-notification-email';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = join(__dirname, 'dd-renewal-emails');
mkdirSync(outputDir, { recursive: true });

const html = generateFeesNotificationEmail(2026);
const filepath = join(outputDir, 'fees-notification-2026.html');
writeFileSync(filepath, html, 'utf-8');

console.log(`Generated fees notification email: ${filepath}`);
