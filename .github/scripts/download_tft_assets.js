const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const url = require('url');
const PQueue = require('p-queue');

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
    const response = await axios.get(imageUrl, { responseType: 'stream', timeout: 60000 });
    if (response.status === 200) {
      await fs.mkdir(path.dirname(savePath), { recursive: true });
      const writer = require('fs').createWriteStream(savePath);
      response.data.pipe(writer);
      await new Promise((resolve, reject) => {
        writer.on('finish', () => {
          console.log(`Đã tải thành công: ${savePath}`);
          resolve();
        });
        writer.on('error', reject);
      });
    } else {
      console.error(`Tải thất bại: ${imageUrl}, status: ${response.status}`);
    }
  } catch (error) {
    console.error(`Lỗi khi tải ${imageUrl}: ${error.message}`);
  }
}

async function fetchWithRetry(url, retries = 5, delay = 5000) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await axios.get(url, { timeout: 60000 });
      return response;
    } catch (error) {
      if (i === retries - 1) throw error;
      console.log(`Thử lại ${url} lần ${i + 1}/${retries} sau ${delay}ms...`);
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

    console.log(`Chuẩn bị tải ${images.length} ảnh từ ${apiUrl}...`);
    // Giới hạn 5 request đồng thời để tránh rate limit
    const queue = new PQueue({ concurrency: 5 });
    await queue.addAll(
      images.map(imgUrl => async () => {
        const filename = path.basename(url.parse(imgUrl).pathname);
        const savePath = path.join(outputDir, filename);
        await downloadImage(imgUrl, savePath);
      })
    );
    console.log(`Hoàn tất tải ${images.length} ảnh từ ${apiUrl}`);
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
