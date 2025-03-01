export default {
  async fetch(request, env) {
    return await handleRequest(request, env);
  }
};

async function handleRequest(request, env) {
  if (request.method !== 'POST') {
    console.log('Non-POST request received');
    return new Response('Method Not Allowed', { status: 405 });
  }

  let telegramResponse;
  let chatId;
  try {
    const body = await request.json();
    console.log('Received request body:', JSON.stringify(body));

    const message = body.message || body.edited_message;
    if (!message || !message.chat || !message.chat.id) {
      console.log('Skipping non-message update or invalid format:', JSON.stringify(body));
      return new Response('OK - Non-message update ignored', { status: 200 });
    }

    chatId = message.chat.id;
    const userText = message.text || 'No message provided';
    console.log(`Processing message from chat ${chatId}: ${userText}`);

    // 环境变量和 KV 检查
    if (!env) {
      console.error('Environment object (env) is undefined');
      throw new Error('Worker environment not properly initialized');
    }
    if (!env.SEARCH_COUNT_KV) {
      console.error('SEARCH_COUNT_KV is not bound to Worker');
      throw new Error('KV namespace "SEARCH_COUNT_KV" not configured.');
    }
    if (!env.YOUR_TELEGRAM_BOT_TOKEN) {
      console.error('YOUR_TELEGRAM_BOT_TOKEN is not configured in env');
      throw new Error('Telegram Bot Token not configured.');
    }
    if (!env.YOUR_PERSONAL_CHAT_ID) {
      console.error('YOUR_PERSONAL_CHAT_ID is not configured in env');
      throw new Error('Personal Chat ID not configured.');
    }
    if (!env.YOUR_GOOGLE_API_KEY) {
      console.error('YOUR_GOOGLE_API_KEY is not configured in env');
      throw new Error('Google API Key not configured.');
    }
    if (!env.YOUR_CUSTOM_SEARCH_ENGINE_ID) {
      console.error('YOUR_CUSTOM_SEARCH_ENGINE_ID is not configured in env');
      throw new Error('Custom Search Engine ID not configured.');
    }
    if (!env.YOUR_OPENROUTER_API_KEY) {
      console.error('YOUR_OPENROUTER_API_KEY is not configured in env');
      throw new Error('OpenRouter API Key not configured.');
    }
    console.log('All required environment variables and KV namespace are bound successfully');

    let searchCount = parseInt(await env.SEARCH_COUNT_KV.get('search_count')) || 0;
    let lastResetDate = await env.SEARCH_COUNT_KV.get('last_reset_date') || '1970-01-01';
    const today = new Date().toISOString().split('T')[0];

    if (lastResetDate !== today) {
      console.log('Resetting search count for new day');
      searchCount = 0;
      await env.SEARCH_COUNT_KV.put('last_reset_date', today);
      await env.SEARCH_COUNT_KV.put('search_count', searchCount.toString());
    }

    searchCount += 1;
    await env.SEARCH_COUNT_KV.put('search_count', searchCount.toString());
    console.log(`Search count updated to: ${searchCount}`);

    if (searchCount === 96) {
      console.log('Sending usage warning to personal chat');
      await sendToTelegram(env.YOUR_PERSONAL_CHAT_ID, '警告：Google Custom Search API 使用次数已达 95 次，接近每日 100 次免费额度上限！', env.YOUR_TELEGRAM_BOT_TOKEN);
    }

    const searchResults = await searchWeb(userText, env.YOUR_GOOGLE_API_KEY, env.YOUR_CUSTOM_SEARCH_ENGINE_ID);
    const searchSummary = searchResults.slice(0, 3).map(r => r.snippet).join(' ') || '未找到相关搜索结果';
    console.log(`Search summary: ${searchSummary}`);

    const prompt = `你是一位 AI 助手，现在通过网络搜索获得了以下最新信息，请基于这些信息回答用户的问题。搜索结果摘要：\n\n${searchSummary}\n\n用户问题：${userText}\n\n请以简洁、准确的方式回答，并说明这是基于网络搜索的最新数据。`;
    console.log('Sending prompt to DeepSeek:', prompt);

    const deepseekResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.YOUR_OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'deepseek/deepseek-r1',
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!deepseekResponse.ok) {
      const errorText = await deepseekResponse.text();
      console.error(`DeepSeek API error: ${deepseekResponse.status}, Response: ${errorText}`);
      throw new Error(`OpenRouter API error: ${deepseekResponse.status}`);
    }

    const data = await deepseekResponse.json();
    const reply = data.choices?.[0]?.message?.content || 'No response from model';
    console.log(`DeepSeek reply: ${reply}`);

    telegramResponse = await sendToTelegram(chatId, reply, env.YOUR_TELEGRAM_BOT_TOKEN);
  } catch (error) {
    console.error('Error in handleRequest:', error.stack || error.message);
    if (chatId && env?.YOUR_TELEGRAM_BOT_TOKEN) {
      telegramResponse = await sendToTelegram(chatId, `服务暂时不可用，请稍后再试。错误：${error.message}`, env.YOUR_TELEGRAM_BOT_TOKEN);
    }
    return new Response(`Error: ${error.message}`, { status: 500 });
  }

  return new Response('OK', { status: 200 });
}

async function searchWeb(query, apiKey, cx) {
  const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(query)}&num=3`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Google API error: ${response.status}, Response: ${errorText}`);
      throw new Error(`Google Custom Search API error: ${response.status}`);
    }
    const data = await response.json();
    return data.items || [];
  } catch (error) {
    console.error('Search error:', error.message);
    return [];
  }
}

async function sendToTelegram(chatId, text, token) {
  const telegramApi = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const response = await fetch(telegramApi, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Telegram API error: ${response.status}, Response: ${errorText}`);
      throw new Error(`Telegram API error: ${response.status}`);
    }
    return response;
  } catch (error) {
    console.error('Telegram error:', error.message);
    throw error;
  }
}