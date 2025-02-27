addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const { message } = await request.json();
  const userText = message?.text || 'No message provided';

  // 调用OpenRouter API
  const deepseekResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${YOUR_OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'deepseek/deepseek-r1', // 或其他DeepSeek模型
      messages: [{ role: 'user', content: userText }],
    }),
  });

  const data = await deepseekResponse.json();
  const reply = data.choices[0].message.content;

  // 发送回复到Telegram
  const telegramApi = `https://api.telegram.org/bot${YOUR_TELEGRAM_BOT_TOKEN}/sendMessage`;
  await fetch(telegramApi, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: message.chat.id,
      text: reply,
    }),
  });

  return new Response('OK', { status: 200 });
}
