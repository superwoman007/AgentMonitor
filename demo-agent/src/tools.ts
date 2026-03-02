// Demo 工具函数 - 模拟真实 API 调用

// 模拟 LLM 调用
export async function mockLLM(prompt: string): Promise<string> {
  const responses = [
    '好的，我明白了。请问还有什么可以帮您的？',
    '这是一个很好的问题。让我为您解答...',
    '感谢您的咨询。我已经记录了您的需求。',
  ];
  return responses[Math.floor(Math.random() * responses.length)];
}

// 查询天气
export async function checkWeather(city: string): Promise<{ city: string; weather: string; temp: number }> {
  console.log(`   🔍 查询 ${city} 天气...`);
  
  // 模拟 API 延迟
  await new Promise(resolve => setTimeout(resolve, 500));
  
  const weathers = [
    '晴天',
    '多云',
    '小雨',
    '大雨',
  ];
  
  return {
    city,
    weather: weathers[Math.floor(Math.random() * weathers.length)],
    temp: Math.floor(Math.random() * 30) + 5,
  };
}

// 查询订单状态
export async function getOrderStatus(): Promise<string> {
  console.log('   🔍 查询订单状态...');
  await new Promise(resolve => setTimeout(resolve, 300));
  return '已发货，预计 2-3 天送达';
}

// 慢查询订单（模拟延迟问题）
export async function slowOrderCheck(): Promise<string> {
  console.log('   🔍 慢查询订单状态（模拟 5 秒延迟）...');
  await new Promise(resolve => setTimeout(resolve, 5000));
  return '已发货，预计 2-3 天送达（慢查询完成）';
}

// 故意失败的函数
export async function failingOperation(): Promise<string> {
  await new Promise(resolve => setTimeout(resolve, 200));
  throw new Error('Operation failed intentionally');
}
