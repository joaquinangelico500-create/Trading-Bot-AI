const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Run the actual functions from the application script without starting its UI,
// timers or network requests. Fail loudly if the source boundaries change.
const html = fs.readFileSync(path.join(__dirname, '../assets/trading_bot_ai_3_7_2.js'), 'utf8');
function section(start, end) {
  const a = html.indexOf(start), b = html.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `Missing source boundaries: ${start}`);
  return html.slice(a, b);
}
function engine() {
  const context = vm.createContext({
    document: { getElementById: () => ({}) },
    localStorage: { setItem() {} },
  });
  vm.runInContext(section("const $=id=>", 'function drawChart()') +
    '\nfunction render() {}\n' + section('function backtestEngine(', "$('runtest').onclick"), context);
  return code => vm.runInContext(code, context);
}
function near(actual, expected, tolerance = 1e-8) {
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
}
const settings = { capital: 10000, fee: 0, slip: 0, allocation: 10,
  daily: 10, stoploss: 3, takeprofit: 6, mode: 'trend' };
// Gentle upward trend with alternating changes: eligible trend signal at 45.
function candles(n = 70) {
  return Array.from({ length: n }, (_, i) => {
    const price = 100 + i * .1 + (i % 2 ? 1 : 0);
    return [1700000000000 + i * 60000, price, price, price, price];
  });
}
function backtest(rows, overrides = {}) {
  return engine()(`backtestEngine(${JSON.stringify(rows)}, ${JSON.stringify({ ...settings, ...overrides })})`);
}

test('SMA and EMA: warmup, seed and independently calculated recurrence', () => {
  const run = engine();
  assert.equal(run('sma([1,2],3)'), null);
  assert.equal(run('sma([1,2,3,4],3)'), 3);
  assert.equal(run('emaSeries([1,2],3).length'), 0);
  assert.equal(run('emaSeries([1,2,3,4,5],3)[0]'), null);
  near(run('emaSeries([1,2,3,4,5],3)[2]'), 2);
  near(run('emaSeries([1,2,3,4,5],3)[4]'), 4);
});
test('RSI uses the last 14 changes, including flat/up/down and mixed prices', () => {
  const run = engine();
  assert.equal(run('indicators(Array(14).fill(100)).rsi'), null);
  assert.equal(run('indicators(Array(40).fill(100)).rsi'), 50);
  assert.equal(run('indicators(Array.from({length:40},(_,i)=>i+1)).rsi'), 100);
  assert.equal(run('indicators(Array.from({length:40},(_,i)=>100-i)).rsi'), 0);
  // Seven +2 and seven -1 changes: gains 14, losses 7 => RSI 66 2/3.
  near(run('indicators(Array.from({length:15},(_,i)=>100+Math.floor(i/2)+(i%2)*2)).rsi'), 200 / 3);
});
test('MACD on a linear series is 7; signal appears after nine MACD samples', () => {
  const run = engine();
  assert.equal(run('indicators(Array(25).fill(100)).macd'), null);
  assert.equal(run('indicators(Array(33).fill(100)).macdSignal'), null);
  near(run('indicators(Array.from({length:34},(_,i)=>i+1)).macd'), 7);
  near(run('indicators(Array.from({length:34},(_,i)=>i+1)).macdSignal'), 7);
});
test('simulated round trip accounts for both fees, cash and net profit', () => {
  const run = engine();
  assert.equal(run("quotes.BTCUSDT={price:100,received:Date.now()};transact('BTCUSDT','COMPRA','test')"), true);
  near(run('cash'), 8999);
  near(run('positions.BTCUSDT.qty'), 10);
  run("quotes.BTCUSDT.price=110;transact('BTCUSDT','VENTA','test')");
  near(run('cash'), 10097.9);
  near(run('closedTrades[0].profit'), 97.9);
  near(run('closedTrades[0].buyFee+closedTrades[0].sellFee'), 2.1);
});
test('stale prices, position limit and insufficient cash reject purchases', () => {
  const run = engine();
  assert.equal(run("quotes.BTCUSDT={price:100,received:Date.now()-90001};transact('BTCUSDT','COMPRA','test')"), false);
  run('quotes.BTCUSDT.received=Date.now();cfg.maxpositions=1');
  assert.equal(run("transact('BTCUSDT','COMPRA','test')"), true);
  assert.equal(run("quotes.ETHUSDT={price:100,received:Date.now()};transact('ETHUSDT','COMPRA','test')"), false);
  assert.equal(engine()("cash=5;quotes.BTCUSDT={price:100,received:Date.now()};transact('BTCUSDT','COMPRA','test')"), false);
});
for (const [price, reason] of [[97, 'Stop loss'], [106, 'Take profit']]) {
  test(`live risk closes at ${reason} threshold`, () => {
    const run = engine();
    run("quotes.BTCUSDT={price:100,received:Date.now()};transact('BTCUSDT','COMPRA','test')");
    run(`quotes.BTCUSDT.price=${price};riskCheck()`);
    assert.equal(run('closedTrades[0].reason'), reason);
    assert.equal(run('Object.keys(positions).length'), 0);
  });
}
test('live risk blocks at session loss and after three consecutive losing closes', () => {
  const run = engine();
  run('cash=9800;riskCheck()');
  assert.equal(run('blocked'), true);
  const streak = engine();
  streak("quotes.BTCUSDT={price:100,received:Date.now()};for(let i=0;i<3;i++){transact('BTCUSDT','COMPRA','test');transact('BTCUSDT','VENTA','test')}");
  assert.equal(streak('lossStreak'), 3);
  assert.equal(streak('blocked'), true);
});
test('backtest executes prior-candle signal at next open and reconciles costs', () => {
  const rows = candles(46);
  assert.equal(engine()(`indicators(${JSON.stringify(rows.slice(0,45).map(r=>r[4]))}).rsi>=40`), true);
  rows[45] = [rows[45][0], 110, 112, 109, 111];
  const result = backtest(rows, { fee: .1, slip: .05, stoploss: 15, takeprofit: 30 });
  assert.equal(result.trades.length, 1);
  const t = result.trades[0];
  assert.equal(t.opened, new Date(rows[45][0]).toISOString());
  near(t.entry, 110 * 1.0005);
  near(t.exit, 111 * .9995);
  const qty = 1000 / (110 * 1.0005);
  const feeOut = qty * 111 * .9995 * .001;
  near(t.profit, qty * 111 * .9995 - feeOut - 1001);
  near(t.profit, t.grossPnL - t.fees - t.slippageCost);
  near(result.cash, 10000 + t.profit);
  near(result.totalCosts, t.fees + t.slippageCost);
});
for (const [ohlc, reason, exit] of [
  [[100,107,96,100], 'Stop loss',97],
  [[100,107,99,100], 'Take profit',106],
]) {
  test(`backtest ${reason}: intrabar thresholds and stop-first ambiguity`, () => {
    const rows = candles(46); rows[45] = [rows[45][0], ...ohlc];
    const r = backtest(rows);
    assert.equal(r.trades.length,1);
    assert.equal(r.trades[0].reason,reason);
    near(r.trades[0].exit,exit);
  });
}
test('backtest fills a stop gap at the worse opening price', () => {
  const rows=candles(47);
  rows[45]=[rows[45][0],105,105,105,105];
  rows[46]=[rows[46][0],90,90,90,90];
  const r=backtest(rows);
  assert.equal(r.trades[0].reason,'Stop con gap');
  near(r.trades[0].exit,90);
});
test('backtest session loss halts further entries', () => {
  const rows=candles(70);rows[45]=[rows[45][0],100,100,50,50];
  const r=backtest(rows,{daily:.1});
  assert.equal(r.halt,true);
  assert.match(r.haltReason,/Límite de pérdida/);
  assert.equal(r.trades.length,1);
});
test('future candles cannot change earlier completed trades', () => {
  const rows=candles(70);rows[45]=[rows[45][0],100,107,96,100];
  const original=backtest(rows);
  const changed=rows.map((r,i)=>i<50?r:[r[0],500,900,1,500]);
  const altered=backtest(changed);
  assert.ok(original.trades.length>0);
  const cutoff=new Date(rows[50][0]).toISOString();
  const before=r=>JSON.stringify(r.trades.filter(t=>t.time<cutoff));
  assert.equal(before(original),before(altered));
});

test('risk preserves positions with expired quotes, then closes after fresh data', () => {
  const run = engine();
  run("quotes.BTCUSDT={price:100,received:Date.now()};transact('BTCUSDT','COMPRA','test')");
  run('quotes.BTCUSDT.price=90;quotes.BTCUSDT.received=Date.now()-90001;riskCheck()');
  assert.equal(run('closedTrades.length'), 0);
  assert.equal(run('Object.keys(positions).length'), 1);
  run('quotes.BTCUSDT.received=Date.now();riskCheck()');
  assert.equal(run('closedTrades.length'), 1);
  assert.equal(run('closedTrades[0].reason'), 'Stop loss');
  near(run('closedTrades[0].exit'), 90);
});

test('emergency blocks entries and retains stale positions until fresh quotes', () => {
  const run = engine();
  run("quotes.BTCUSDT={price:100,received:Date.now()};transact('BTCUSDT','COMPRA','test')");
  run("quotes.BTCUSDT.received=Date.now()-90001;emergency('test emergency')");
  assert.equal(run('blocked'), true);
  assert.equal(run('running'), false);
  assert.equal(run('Object.keys(positions).length'), 1);
  run("quotes.BTCUSDT.received=Date.now();emergency('test emergency')");
  assert.equal(run('Object.keys(positions).length'), 0);
  assert.equal(run("transact('BTCUSDT','COMPRA','test')"), false);
});

test('a profitable close resets the live losing streak', () => {
  const run = engine();
  run("quotes.BTCUSDT={price:100,received:Date.now()};transact('BTCUSDT','COMPRA','test');transact('BTCUSDT','VENTA','test')");
  assert.equal(run('lossStreak'), 1);
  run("transact('BTCUSDT','COMPRA','test');quotes.BTCUSDT.price=110;transact('BTCUSDT','VENTA','test')");
  assert.equal(run('lossStreak'), 0);
  assert.equal(run('blocked'), false);
});

test('backtest fills a favorable take-profit gap at the actual opening price', () => {
  const rows = candles(47);
  rows[45] = [rows[45][0], 105, 105, 105, 105];
  rows[46] = [rows[46][0], 115, 115, 115, 115];
  const result = backtest(rows);
  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].reason, 'Take con gap');
  near(result.trades[0].exit, 115);
});
