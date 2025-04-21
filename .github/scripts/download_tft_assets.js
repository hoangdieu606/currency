const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const url = require('url');

async function getCurrentVersion() {
  try {
    const data = await fs.readFile('version.json', 'utf8');
    return JSON.parse(data).version || '0.0';
  } catch (error) {
    return '0.0';
  }
}

async function saveCurrentVersion(version) {
  await fs.writeFile('version.json', JSON.stringify({ version }));
}

async function downloadImage(imageUrl, savePath) {
  try {
    const response = await axios.get(imageUrl, { responseType: 'stream', timeout: 30000 });
    if (response.status === 200) {
      await fs.mkdir(path.dirname(savePath), { recursive: true });
      const writer = require('fs').createWriteStream(savePath);
      response.data.pipe(writer);
      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });
      console.log(`Đã tải: ${savePath}`);
    } else {
      console.error(`Tải thất bại: ${imageUrl}, status: ${response.status}`);
    }
  } catch (error) {
    console.error(`Lỗi khi tải ${imageUrl}: ${error.message}`);
  }
}

async function fetchWithRetry(url, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await axios.get(url, { timeout: 30000 });
      return response;
    } catch (error) {
      if (i === retries - 1) throw error;
      console.log(`Thử lại ${url} sau ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

async function processApi(apiUrl, setNumber, outputDir) {
  try {
    const response = await fetchWithRetry(apiUrl);
    if (response.status !== 200) {
      console.error(`Gọi API thất bại: ${apiUrl}, status: ${response.status}`);
      return;
    }
    const images = [];
    response.data.data.forEach(item => {
      if (item.imageUrl) images.push(item.imageUrl);
      if (item.skillImageUrl) images.push(item.skillImageUrl);
    });

    const MAX_IMAGES = 50;
    await Promise.all(
      images.slice(0, MAX_IMAGES).map(async (imgUrl) => {
        const filename = path.basename(url.parse(imgUrl).pathname);
        const savePath = path.join(outputDir, filename);
        await downloadImage(imgUrl, savePath);
      })
    );
  } catch (error) {
    console.error(`Lỗi xử lý API ${apiUrl}: ${error.message}`);
  }
}

async function main() {
  const apis = [
    'https://tft-api.op.gg/api/v1/meta/champions?hl=vi_VN',
    'https://tft-api.op.gg/api/v1/meta/traits?hl=vi_VN',
    'https://tft-api.op.gg/api/v1/meta/augments?hl=vi_VN',
    'https://tft-api.op.gg/api/v1/meta/items?hl=vi_VN'
  ];

  const response = await fetchWithRetry(apis[0]).catch(err => {
    console.error(`Không thể lấy version từ API: ${err.message}`);
    return null;
  });
  if (!response) return;

  const newVersion = response.data.version || '0.0';
  const setNumber = response.data.set;
  const currentVersion = await getCurrentVersion();

  if (newVersion === currentVersion) {
    console.log('Version không thay đổi, bỏ qua tải assets');
    return;
  }

  console.log(`Phát hiện version mới: ${newVersion}. Bắt đầu tải assets...`);
  const outputDir = `public/assets/images/set${setNumber}`;
  await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(outputDir, { recursive: true });

  for (const apiUrl of apis) {
    await processApi(apiUrl, setNumber, outputDir);
  }

  await saveCurrentVersion(newVersion);
}

main().catch(error => {
  console.error(`Lỗi chính: ${error.message}`);
  process.exit(1);
});
