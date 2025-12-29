/**
 * Image Optimization Script
 * Converts large PNG images to optimized WebP format
 * Run with: node scripts/optimize-images.js
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const assetsDir = path.join(__dirname, '../src/assets');
const imagesToOptimize = [
  { input: 'divider.png', output: 'divider.webp' },
  { input: 'img1.png', output: 'img1.webp' },
  { input: 'img2.png', output: 'img2.webp' },
  { input: 'img3.png', output: 'img3.webp' },
  { input: 'img4.png', output: 'img4.webp' },
];

async function optimizeImages() {
  console.log('🖼️  Starting image optimization...\n');

  for (const { input, output } of imagesToOptimize) {
    const inputPath = path.join(assetsDir, input);
    const outputPath = path.join(assetsDir, output);

    if (!fs.existsSync(inputPath)) {
      console.log(`⚠️  Skipping ${input} - file not found`);
      continue;
    }

    try {
      const inputStats = fs.statSync(inputPath);
      const inputSizeKB = (inputStats.size / 1024).toFixed(2);

      await sharp(inputPath)
        .webp({ quality: 85, effort: 6 })
        .toFile(outputPath);

      const outputStats = fs.statSync(outputPath);
      const outputSizeKB = (outputStats.size / 1024).toFixed(2);
      const savings = ((1 - outputStats.size / inputStats.size) * 100).toFixed(1);

      console.log(`✅ ${input} → ${output}`);
      console.log(`   Size: ${inputSizeKB} KB → ${outputSizeKB} KB (${savings}% smaller)\n`);
    } catch (error) {
      console.error(`❌ Error optimizing ${input}:`, error.message);
    }
  }

  console.log('✨ Image optimization complete!');
  console.log('\n📝 Next steps:');
  console.log('1. Update import statements in src/parts/Navigation.tsx');
  console.log('2. Update import statement in src/parts/Divider.tsx');
  console.log('3. Test the application to ensure images load correctly');
}

optimizeImages().catch(console.error);
