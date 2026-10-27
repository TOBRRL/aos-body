/* Read-only POS snapshot adapter. No credentials, uploads, or legacy storage writes. */
(() => {
  'use strict';
  const localBridge = location.hostname === '127.0.0.1';
  const fields = [
    ['sleep_minutes', '主睡眠', '分'],
    ['resting_heart_rate', '静息心率', 'bpm'],
    ['hrv_rmssd', '日均 HRV', 'ms']
  ];
  const states = {available:'接口原值 · 待逐项核对',missing:'未返回记录',conflict:'数据冲突 · 未合并',
    incomplete:'字段缺失或无效',sync_unavailable:'本次未同步成功'};
  let snapshot = null, selectedDate = null, error = '', loading = false, followToday = true;
  const byId = id => document.getElementById(id);
  function today() {
    return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  }
  function node(tag, text, className) {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (className) el.className = className;
    return el;
  }
  function value(key, metric, compact = false) {
    if (!metric || metric.state !== 'available' || metric.value === null) return '—';
    if (key === 'sleep_minutes') {
      const hours = Math.floor(metric.value / 60), minutes = metric.value % 60;
      return compact ? `${hours}h ${minutes}m` : `${hours} 小时 ${minutes} 分`;
    }
    return key === 'steps' ? metric.value.toLocaleString('zh-CN') : String(metric.value);
  }
  function entry() {return snapshot?.days.find(day => day.date === selectedDate);}
  function syncTime() {
    const date = new Date(snapshot?.checked_at);
    return Number.isNaN(date.getTime()) ? '未知' : date.toLocaleString('zh-CN', {timeZone:'Asia/Shanghai',hour12:false});
  }
  function connection() {
    if (!localBridge) return '在线界面已更新 · 私有健康数据尚未连接';
    if (error) return error + '；数值已隐藏，未回退到旧手动记录';
    if (!snapshot) return '等待连接本机 POS';
    const age = Date.now() - new Date(snapshot.checked_at).getTime();
    if (!Number.isFinite(age) || age < -300000 || age > 24 * 3600000) return '快照时间异常或已超过 24 小时，请先在 POS 手动同步';
    if (!snapshot.source_complete) return '本次同步不完整，请核对缺失项';
    if (selectedDate !== today()) return '正在查看历史日期，不代表今天的身体状态';
    return '已连接本机 POS · 自动读取快照，不代表实时设备数据';
  }
  function renderTile() {
    const row = error ? null : entry(), host = byId('posTileMetrics');
    host.replaceChildren();
    byId('posTileDate').textContent = snapshot && !error ? `${selectedDate} · 北京时间` : '等待有效快照';
    fields.forEach(([key,label,unit]) => {
      const box = node('div', undefined, 'posTileMetric');
      box.append(node('small', label));
      const val = node('b', value(key,row?.metrics[key],true));
      if (key !== 'sleep_minutes') val.append(node('i', unit));
      box.append(val);host.append(box);
    });
    byId('posTileState').textContent = connection();
    const score = row?.body_score;
    byId('posBodyScore').textContent = score?.value != null ? String(score.value) : '—';
    const base = score?.components;
    byId('posScoreState').textContent = !score ? '身体总分 · 等待有效快照' : score.value != null ? '身体总分 · 实验性个人趋势'
      : score.reasons.includes('baseline_warming_up') ? `基线建立中 · HRV ${base.hrv_rmssd.baseline.count}/14 · 心率 ${base.resting_heart_rate.baseline.count}/14` : '数据待核对 · 暂不评分';
  }
  function renderScore(row) {
    const host = byId('posScoreBreakdown');host.replaceChildren();
    const score = row?.body_score;
    host.append(node('h3', score?.value != null ? `身体总分 ${score.value} / 100` : score?.reasons.includes('baseline_warming_up') ? '身体总分：建立基线中' : '身体总分：暂不可用'));
    if (!score) {host.append(node('p',localBridge ? '暂无有效数据，先连接本机 POS。' : '在线站点尚未接入私有 POS 数据通道；上传源码不会上传个人健康数据。'));return;}
    host.append(node('p','实验性个人趋势分；权重为工程选择，不是医学结论。'));
    const list = node('ul');
    fields.forEach(([key,label]) => {
      const part = score.components[key], base = part.baseline;
      const detail = base ? `过去 28 天 ${base.count}/14 日，近 7 天 ${base.recent_count}/3 日` : `暂定目标 ${score.sleep_target_minutes / 60} 小时，未按年龄个体化`;
      list.append(node('li',`${label} · 权重 ${Math.round(part.weight*100)}% · ${part.score === null ? '待积累' : part.score+' 分'}；${detail}`));
      if (base?.excluded_source_days) list.append(node('li',`另有 ${base.excluded_source_days} 日来源或计算方法不同，未混入该基线`));
    });host.append(list);
    const reasons = {baseline_warming_up:'个人基线不足，暂不输出总分',current_metrics_missing:'所选日期有缺失或无效项，不重分配权重',
      history_integrity_unavailable:'历史快照存在校验问题，暂不输出总分',snapshot_stale:'快照已过期或时间异常，暂不输出总分'};
    score.reasons.forEach(reason=>host.append(node('p',reasons[reason]||'数据待核对')));
    host.append(node('p','历史日只计同来源、同计算方法，不包含所选当天。'));
    host.append(node('p','较高分仅表示睡眠时长接近暂定目标、心率指标接近个人常态；不代表没有疾病或适合训练。'));
  }
  function renderTrend() {
    const host=byId('posTrendTable');host.replaceChildren();
    if (error || !snapshot?.trend?.length) {host.append(node('p','暂无可显示的趋势'));return;}
    const table=node('table'),head=node('tr');
    ['日期','睡眠','静息心率','HRV'].forEach(label=>head.append(node('th',label)));
    const thead=node('thead');thead.append(head);table.append(thead);
    const body=node('tbody');
    snapshot.trend.forEach(day=>{
      const row=node('tr');row.append(node('td',day.date.slice(5)));
      fields.forEach(([key,,unit])=>{
        const metric=day.metrics[key];
        row.append(node('td',value(key,metric,true)+(key==='sleep_minutes'?'':' '+unit)+(metric.state==='available'&&!metric.comparable?' †':'')));
      });
      body.append(row);
    });table.append(body);host.append(table,node('p','† 与最新日期的来源或计算方法不同，仅展示原值，不混入当前基线。'));
  }
  function render() {
    renderTile();
    const row = error ? null : entry(), host = byId('posDetailMetrics');
    renderScore(row);renderTrend();
    host.replaceChildren();
    fields.forEach(([key,label,unit]) => {
      const metric = row?.metrics[key];
      const box = node('article', undefined, 'posDetailMetric');
      box.append(node('h3', label),node('strong',value(key,metric)));
      box.append(node('small',key === 'sleep_minutes' ? '分钟原值换算，不含午睡累加' : unit));
      box.append(node('small',metric ? states[metric.state] : '暂无可显示数据'));
      if (metric?.sources.length) box.append(node('small','来源：' + metric.sources.join('、')));
      if (metric?.warnings.length) box.append(node('small',metric.warnings.join('；')));
      host.append(box);
    });
    byId('posConnectionState').textContent = connection();
    byId('posCheckedAt').textContent = snapshot && !error ? `最近 Google 同步：${syncTime()}（北京时间） · 页面每 60 秒读取本机快照` : '';
    const picker = byId('posHealthDate');picker.replaceChildren();
    (snapshot?.days || []).slice().reverse().forEach(day => {
      const option = node('option',day.date === today() ? `${day.date} · 今天` : day.date);
      option.value = day.date;picker.append(option);
    });
    picker.value = selectedDate || '';picker.disabled = !!error || !snapshot;
  }
  function valid(data) {
    if (data?.schema !== 'pos.aosbody.health.v2' || !Array.isArray(data.days) || data.days.length > 7 || !Array.isArray(data.trend)) return false;
    if (data.trend.length>7 || !data.trend.every(day=>/^\d{4}-\d{2}-\d{2}$/.test(day.date) && fields.every(([key])=>{
      const m=day.metrics?.[key];return m && Object.hasOwn(states,m.state) && (m.state!=='available'||(typeof m.value==='number'&&Number.isFinite(m.value)&&m.value>=0));
    }))) return false;
    return data.days.every(day => /^\d{4}-\d{2}-\d{2}$/.test(day.date) && fields.every(([key]) => {
      const metric=day.metrics?.[key];
      return metric && Object.hasOwn(states,metric.state) && Array.isArray(metric.sources) && Array.isArray(metric.warnings)
        && (metric.state !== 'available' || (typeof metric.value === 'number' && Number.isFinite(metric.value) && metric.value >= 0));
    }) && validScore(day.body_score));
  }
  function validScore(score) {
    if (!score || score.algorithm!=='personal_trend_v1' || !Array.isArray(score.reasons) || !score.components || !(score.sleep_target_minutes>=240&&score.sleep_target_minutes<=720) || (score.value !== null && (!Number.isInteger(score.value)||score.value<0||score.value>100))) return false;
    const weights={sleep_minutes:.4,hrv_rmssd:.35,resting_heart_rate:.25};
    const componentsValid=fields.every(([key])=>{
      const c=score.components[key];
      return c && c.weight===weights[key] && (c.score===null || (typeof c.score==='number' && Number.isFinite(c.score) && c.score>=0 && c.score<=100))
        && (key==='sleep_minutes' || (c.baseline && Number.isInteger(c.baseline.count) && c.baseline.count>=0 && c.baseline.count<=28 && Number.isInteger(c.baseline.recent_count) && c.baseline.recent_count>=0 && c.baseline.recent_count<=7));
    });
    if (!componentsValid) return false;
    if (score.value!==null) return score.reasons.length===0 && fields.every(([key])=>score.components[key].score!==null)
      && ['hrv_rmssd','resting_heart_rate'].every(key=>score.components[key].baseline.count>=14&&score.components[key].baseline.recent_count>=3)
      && Math.abs(score.value-fields.reduce((sum,[key])=>sum+weights[key]*score.components[key].score,0))<=0.500001;
    return true;
  }
  async function refresh() {
    if (!localBridge) {
      byId('posHealthRefresh').disabled=true;
      byId('posHealthRefresh').textContent='等待私有数据接入';
      render();return;
    }
    if (loading) return;
    loading = true;byId('posHealthRefresh').disabled = true;
    try {
      const response = await fetch('/pos/health-summary.json',{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(8000)});
      if (!response.ok) throw new Error('unavailable');
      const data = await response.json();if (!valid(data)) throw new Error('invalid');
      snapshot = data;error = '';
      if (followToday || !data.days.some(day => day.date === selectedDate)) selectedDate = data.days.some(day => day.date === today()) ? today() : data.days.at(-1)?.date;
    } catch (_) {error = '本机 POS 未连接或快照校验未通过';}
    finally {loading = false;byId('posHealthRefresh').disabled = false;render();}
  }
  window.posHealth = {
    renderTile,
    open() {
      byId('dailyStatusBackdrop').classList.add('open');byId('dailyStatusSheet').classList.add('open');
      render();refresh();byId('posHealthRefresh').focus();
    }
  };
  byId('posHealthDate').addEventListener('change',event => {selectedDate=event.target.value;followToday=selectedDate===today();render();});
  byId('posHealthRefresh').addEventListener('click',refresh);
  document.addEventListener('keydown',event => {if (event.key === 'Escape') closeDailyStatusModal();});
  render();refresh();
  if (localBridge) setInterval(() => {if (!document.hidden) refresh();},60000);
  document.addEventListener('visibilitychange',() => {if (!document.hidden) refresh();});
})();
