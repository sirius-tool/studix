const corsHeaders = {
  "Access-Control-Allow-Origin": "https://sirius-tool.github.io",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8"
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: corsHeaders });
const API_URL = "https://ai-api.metro.tokyo.lg.jp/api/v1/public/message";

function extractText(data) {
  return typeof data?.message === "string" ? data.message.trim() : "";
}
function parseJsonText(text) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  return JSON.parse(cleaned);
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    if (request.method !== "POST") return json({ error: "POST only" }, 405);
    if (!env.TORITSU_AI_API_KEY) return json({ error: "サーバー側の都立AIキーが未設定です。管理者に連絡してください。" }, 503);

    let body;
    try { body = await request.json(); }
    catch { return json({ error: "JSONを読み取れませんでした。" }, 400); }

    const mode = body?.mode;
    let prompt = "";
    let jsonMode = false;
    let conversationId = "";

    if (mode === "chat") {
      const question = String(body.question || "").trim().slice(0, 4000);
      if (!question) return json({ error: "質問を入力してください。" }, 400);
      prompt = `あなたは中高生向けの親切な日本語の学習アシスタント「STUDIX AI先生」です。質問に正確に答え、数学などは途中の考え方を段階的に説明してください。必要なら前提や単位を確認し、わからないことは断定しないでください。答えをただ渡すだけでなく理解を助けてください。\n\nユーザーの質問：\n${question}`;
      conversationId = String(body.conversation_id || "").slice(0, 200);
    } else if (mode === "plan") {
      const examDate = String(body.examDate || "").slice(0, 10);
      const today = String(body.today || "").slice(0, 10);
      const subjects = String(body.subjects || "").trim().slice(0, 2000);
      const notes = String(body.notes || "").trim().slice(0, 1000);
      const minutes = Math.max(30, Math.min(240, Number(body.minutesPerDay) || 60));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(examDate) || !/^\d{4}-\d{2}-\d{2}$/.test(today) || !subjects) return json({ error: "入力内容を確認してください。" }, 400);
      if (examDate < today) return json({ error: "テスト日は今日以降にしてください。" }, 400);
      const span = Math.round((Date.parse(examDate + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400000);
      if (span > 60) return json({ error: "テスト日まで60日以内で計画を作成してください。" }, 400);
      jsonMode = true;
      prompt = `あなたは中高生の学習計画を作るアシスタントです。今日=${today}、テスト日=${examDate}。1日あたりの勉強時間の目安=${minutes}分。教科・範囲：${subjects}。希望・苦手：${notes || "特になし"}。\n今日からテスト日まで、無理のない復習・演習・間違い直しを含む日ごとの計画を作成してください。休みが必要な日は軽めにして構いません。各日の合計量が目安時間を大きく超えないようにしてください。\n必ずJSONのみで返してください。形式は {"plans":[{"date":"YYYY-MM-DD","start":"HH:MM","end":"HH:MM","subject":"教科","task":"具体的にやること"}]}。plansは最大60件。dateは今日からテスト日までの範囲。start/endは時刻を決められない場合は空文字。Markdownや説明文は付けないでください。`;
    } else return json({ error: "不明なリクエストです。" }, 400);

    let upstream;
    try {
      upstream = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
          "Authorization": `Bearer ${env.TORITSU_AI_API_KEY}`
        },
        body: JSON.stringify({ input: prompt, conversation_id: conversationId })
      });
    } catch {
      return json({ error: "都立AIに接続できませんでした。時間をおいて再試行してください。" }, 502);
    }

    const result = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const detail = typeof result?.message === "string" ? result.message : "";
      return json({ error: detail || `都立AIでエラーが発生しました（${upstream.status}）。APIキーの有効性や利用条件を確認してください。` }, upstream.status === 429 ? 429 : 502);
    }

    const answer = extractText(result);
    if (!answer) return json({ error: "都立AIから回答を受け取れませんでした。" }, 502);
    const nextConversationId = String(result?.response?.conversation?.id || "").slice(0, 200);

    if (jsonMode) {
      try {
        const parsed = parseJsonText(answer);
        if (!Array.isArray(parsed.plans)) throw new Error("bad format");
        const plans = parsed.plans.filter(p => p && /^\d{4}-\d{2}-\d{2}$/.test(String(p.date || ""))).slice(0, 60).map(p => ({
          date: String(p.date).slice(0, 10),
          start: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(p.start || "")) ? p.start : "",
          end: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(p.end || "")) ? p.end : "",
          subject: String(p.subject || "").slice(0, 80),
          task: String(p.task || "").slice(0, 180)
        })).filter(p => p.task);
        return json({ plans });
      } catch {
        return json({ error: "計画データを読み取れませんでした。もう一度試してください。" }, 502);
      }
    }
    return json({ answer: answer.slice(0, 12000), conversation_id: nextConversationId });
  }
};
