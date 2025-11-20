// 学习通云端自动刷课脚本
// 基于Puppeteer - 适用于GitHub Actions等云端环境

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// 配置项
const config = {
  // 登录信息 - 在实际使用时从环境变量获取
  username: process.env.CHAOXING_USERNAME || '',
  password: process.env.CHAOXING_PASSWORD || '',
  
  // 课程URL - 需要替换为实际的课程页面URL
  courseUrl: 'https://mooc1-1.chaoxing.com/course/209713155.html',
  
  // 浏览器配置
  browserConfig: {
    headless: true, // 云端运行需要设置为true
    slowMo: 0, // 运行速度，0为最快
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1280,800'
    ]
  },
  
  // 运行配置
  runConfig: {
    maxCourseTime: 60 * 60 * 1000, // 最长运行时间（毫秒）
    checkInterval: 5000, // 检查间隔
    videoTimeout: 30000 // 单个视频操作超时
  },
  
  // 元素选择器
  selectors: {
    loginUsername: '#unameId',
    loginPassword: '#passwordId',
    loginButton: '.zl_btn_right',
    nextButton: '#right2',
    videoPlayer: '.video',
    videoFrame: 'iframe',
    playButton: '.vjs-big-play-button',
    progressBar: '.progressbar'
  }
};

// 日志记录函数
function log(message) {
  const timestamp = new Date().toLocaleString('zh-CN');
  console.log(`[${timestamp}] ${message}`);
}

// 保存进度到文件
function saveProgress(progress) {
  try {
    const progressData = {
      ...progress,
      lastUpdated: new Date().toISOString()
    };
    fs.writeFileSync(
      path.join(__dirname, 'progress.json'),
      JSON.stringify(progressData, null, 2)
    );
    log('进度已保存');
  } catch (error) {
    log(`保存进度时出错: ${error.message}`);
  }
}

// 读取进度
function readProgress() {
  try {
    const data = fs.readFileSync(
      path.join(__dirname, 'progress.json'),
      'utf8'
    );
    return JSON.parse(data);
  } catch (error) {
    log('未找到进度文件，从开始位置运行');
    return {
      completedLessons: 0,
      totalLessons: 0,
      lastLessonIndex: 0
    };
  }
}

// 登录函数
async function login(page) {
  try {
    log('开始登录学习通');
    
    // 导航到登录页面
    await page.goto('https://passport2.chaoxing.com/login', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    
    // 输入用户名和密码
    await page.waitForSelector(config.selectors.loginUsername);
    await page.type(config.selectors.loginUsername, config.username);
    await page.type(config.selectors.loginPassword, config.password);
    
    // 点击登录按钮
    await page.click(config.selectors.loginButton);
    
    // 等待登录成功并跳转到首页
    await page.waitForNavigation({
      waitUntil: 'networkidle2',
      timeout: 15000
    });
    
    log('登录成功');
    return true;
  } catch (error) {
    log(`登录失败: ${error.message}`);
    return false;
  }
}

// 进入课程页面
async function navigateToCourse(page) {
  try {
    log(`导航到课程页面: ${config.courseUrl}`);
    await page.goto(config.courseUrl, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    
    // 等待课程内容加载
    await page.waitForSelector('.coursetree', { timeout: 15000 });
    log('课程页面加载完成');
    return true;
  } catch (error) {
    log(`进入课程页面失败: ${error.message}`);
    return false;
  }
}

// 处理视频播放
async function handleVideo(page) {
  try {
    log('开始处理视频播放');
    
    // 等待视频区域加载
    await page.waitForSelector(config.selectors.videoPlayer, { timeout: 10000 });
    
    // 尝试点击视频区域播放
    await page.click(config.selectors.videoPlayer);
    log('点击了视频区域');
    
    // 尝试在iframe中操作
    try {
      // 等待iframe加载
      const iframeElement = await page.waitForSelector(config.selectors.videoFrame, { timeout: 8000 });
      const frame = await iframeElement.contentFrame();
      
      if (frame) {
        log('成功获取视频iframe');
        
        // 在iframe中尝试点击播放按钮
        try {
          await frame.click(config.selectors.playButton, { timeout: 5000 });
          log('在iframe中点击了播放按钮');
        } catch (e) {
          log('iframe中未找到播放按钮，尝试直接点击视频区域');
          await frame.click('video', { timeout: 5000 }).catch(() => {});
        }
      }
    } catch (e) {
      log('处理iframe时出错，可能是跨域限制: ' + e.message);
    }
    
    // 模拟定期检查进度
    let progressChecks = 0;
    const maxChecks = 30; // 最多检查30次（约150秒）
    
    while (progressChecks < maxChecks) {
      try {
        // 检查是否有进度条更新
        const progressElement = await page.$(config.selectors.progressBar);
        if (progressElement) {
          const progressText = await page.evaluate(el => el.textContent, progressElement);
          log(`视频进度: ${progressText}`);
        }
        
        // 每检查一次休息一下
        await page.waitForTimeout(config.runConfig.checkInterval);
        progressChecks++;
        
        // 随机点击页面防止自动暂停
        if (progressChecks % 5 === 0) {
          await page.click('body');
          log('模拟用户活动，防止视频自动暂停');
        }
      } catch (e) {
        log('检查进度时出错: ' + e.message);
      }
    }
    
    log('视频处理时间已到，准备切换到下一节');
    return true;
  } catch (error) {
    log(`处理视频时出错: ${error.message}`);
    return false;
  }
}

// 切换到下一节
async function goToNextLesson(page) {
  try {
    log('尝试切换到下一节');
    
    // 尝试点击下一节按钮
    const nextButton = await page.$(config.selectors.nextButton);
    if (nextButton) {
      await nextButton.click();
      log('点击了下一节按钮');
      
      // 等待页面加载完成
      await page.waitForNavigation({
        waitUntil: 'networkidle2',
        timeout: 20000
      }).catch(() => log('页面导航超时，但继续处理'));
      
      return true;
    } else {
      log('未找到下一节按钮');
      return false;
    }
  } catch (error) {
    log(`切换到下一节时出错: ${error.message}`);
    return false;
  }
}

// 主函数
async function main() {
  let browser = null;
  let page = null;
  const progress = readProgress();
  
  try {
    log('===== 学习通云端自动刷课脚本启动 =====');
    
    // 启动浏览器
    log('启动浏览器...');
    browser = await puppeteer.launch(config.browserConfig);
    page = await browser.newPage();
    
    // 设置页面视图大小
    await page.setViewport({ width: 1280, height: 800 });
    
    // 启用请求拦截，减少不必要的资源加载
    await page.setRequestInterception(true);
    page.on('request', request => {
      const resourceType = request.resourceType();
      // 只拦截图片、样式和字体等资源，允许文档和脚本加载
      if (['image', 'stylesheet', 'font'].includes(resourceType)) {
        request.abort();
      } else {
        request.continue();
      }
    });
    
    // 登录学习通
    if (!await login(page)) {
      log('登录失败，脚本终止');
      return;
    }
    
    // 进入课程页面
    if (!await navigateToCourse(page)) {
      log('无法进入课程页面，脚本终止');
      return;
    }
    
    // 开始处理课程内容
    const startTime = Date.now();
    let lessonCount = 0;
    
    log(`开始处理课程内容，当前进度：已完成 ${progress.completedLessons} 节`);
    
    // 循环处理课程，直到达到最大运行时间
    while (Date.now() - startTime < config.runConfig.maxCourseTime) {
      try {
        // 处理当前视频
        await handleVideo(page);
        
        // 更新进度
        lessonCount++;
        progress.completedLessons++;
        saveProgress(progress);
        log(`已完成 ${lessonCount} 节内容`);
        
        // 切换到下一节
        if (!await goToNextLesson(page)) {
          log('无法继续到下一节，可能已完成所有内容');
          break;
        }
        
        // 切换后休息一下
        await page.waitForTimeout(3000);
        
      } catch (lessonError) {
        log(`处理课程时出错: ${lessonError.message}`);
        // 出错后尝试切换到下一节
        await goToNextLesson(page);
        await page.waitForTimeout(2000);
      }
    }
    
    log(`脚本运行完成。总计处理了 ${lessonCount} 节内容。`);
    
  } catch (error) {
    log(`脚本执行出错: ${error.message}`);
  } finally {
    // 保存最终进度
    saveProgress(progress);
    
    // 关闭浏览器
    if (browser) {
      log('关闭浏览器');
      await browser.close();
    }
    
    log('===== 脚本运行结束 =====');
  }
}

// 运行主函数
main().catch(error => {
  console.error('脚本启动失败:', error);
});
