const TOKEN = '0x9ca1cc0c90d97b4f36c5e2232d4fbd705a73c65d';
const EXPLORER = 'https://robinhoodchain.blockscout.com';
const RPC = 'https://rpc.mainnet.chain.robinhood.com/';
const V4_POOL_MANAGER = '0x8366a39cc670b4001a1121b8f6a443a643e40951';
const V4_SWAP_TOPIC = '0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f';
const V4_INITIALIZE_TOPIC = '0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438';

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, {...options, signal:controller.signal}); }
  finally { clearTimeout(timer); }
}
async function getJson(url) {
  const r = await fetchWithTimeout(url, {headers:{accept:'application/json'}});
  if (!r.ok) throw new Error(`${url} returned ${r.status}`);
  return r.json();
}
async function rpc(payload, timeoutMs=10000) {
  const r = await fetchWithTimeout(RPC, {
    method:'POST',
    headers:{'content-type':'application/json','accept':'application/json'},
    body:JSON.stringify(payload)
  }, timeoutMs);
  if (!r.ok) throw new Error(`Robinhood RPC returned ${r.status}`);
  return r.json();
}
function parseBlockNumber(v) {
  if (v == null) return null;
  const s=String(v); const n=s.startsWith('0x')?parseInt(s,16):Number(s);
  return Number.isFinite(n)?n:null;
}
function rollingStartMs(days){ return Date.now() - days*24*60*60*1000; }
async function getBlockAtTimestamp(ms){
  const u=new URL(`${EXPLORER}/api`);
  u.searchParams.set('module','block'); u.searchParams.set('action','getblocknobytime');
  u.searchParams.set('timestamp',String(Math.floor(ms/1000))); u.searchParams.set('closest','before');
  const j=await getJson(u.toString());
  const b=parseBlockNumber(j?.result?.blockNumber ?? j?.result);
  if(b==null) throw new Error('Could not resolve 30-day start block');
  return b;
}
async function getLatestBlock(){
  const j=await rpc({jsonrpc:'2.0',id:1,method:'eth_blockNumber',params:[]});
  const b=parseBlockNumber(j?.result);
  if(b==null) throw new Error('Could not resolve latest block');
  return b;
}
async function getMarket(){
  const urls=[
    `https://api.dexscreener.com/tokens/v1/robinhood/${TOKEN}`,
    `https://api.dexscreener.com/latest/dex/search?q=${TOKEN}`
  ];
  let last;
  for(const url of urls){
    try{
      const j=await getJson(url);
      const all=Array.isArray(j)?j:(Array.isArray(j?.pairs)?j.pairs:[]);
      const pairs=all.filter(p=>String(p?.baseToken?.address||'').toLowerCase()===TOKEN || String(p?.quoteToken?.address||'').toLowerCase()===TOKEN);
      if(!pairs.length) throw new Error('No TA market pairs returned');
      const ranked=[...pairs].sort((a,b)=>(Number(b?.liquidity?.usd)||0)-(Number(a?.liquidity?.usd)||0));
      const priceRaw=ranked.find(x=>String(x?.baseToken?.address||'').toLowerCase()===TOKEN)?.priceUsd || ranked.find(x=>String(x?.quoteToken?.address||'').toLowerCase()===TOKEN)?.priceUsd;
      const price=Number(priceRaw);
      return {
        poolIds:[...new Set(pairs.map(p=>String(p?.pairAddress||'').toLowerCase()).filter(x=>/^0x[0-9a-f]{64}$/.test(x)))],
        volume24h:pairs.reduce((a,p)=>a+(Number(p?.volume?.h24)||0),0),
        tokenPriceUsd:Number.isFinite(price)&&price>0?price:null
      };
    }catch(e){last=e;}
  }
  throw last || new Error('Market data unavailable');
}
async function explorerLogs({fromBlock,toBlock,topic0,topic1}){
  const u=new URL(`${EXPLORER}/api`);
  u.searchParams.set('module','logs'); u.searchParams.set('action','getLogs');
  u.searchParams.set('fromBlock',String(fromBlock)); u.searchParams.set('toBlock',String(toBlock));
  u.searchParams.set('address',V4_POOL_MANAGER); u.searchParams.set('topic0',topic0);
  if(topic1){u.searchParams.set('topic1',topic1);u.searchParams.set('topic0_1_opr','and');}
  const j=await getJson(u.toString());
  if(Array.isArray(j?.result)) return j.result;
  const msg=String(j?.message||j?.result||'Log query failed');
  if(/no records/i.test(msg)) return [];
  throw new Error(msg);
}
async function logsComplete(params,depth=0){
  if(params.fromBlock>params.toBlock) return [];
  try{
    const rows=await explorerLogs(params);
    if(rows.length<1000 || params.fromBlock===params.toBlock || depth>=14) return rows;
  }catch(e){
    if(params.fromBlock===params.toBlock || depth>=14) throw e;
  }
  const mid=Math.floor((params.fromBlock+params.toBlock)/2);
  const [a,b]=await Promise.all([
    logsComplete({...params,toBlock:mid},depth+1),
    logsComplete({...params,fromBlock:mid+1},depth+1)
  ]);
  return [...a,...b];
}
function topicAddress(topic){const h=String(topic||'').replace(/^0x/,'');return h.length>=40?`0x${h.slice(-40)}`.toLowerCase():null;}
function signedWord(word){let n=BigInt(`0x${word}`);if(n&(1n<<255n))n-=1n<<256n;return n;}
function decodeSwap(data){
  const h=String(data||'').replace(/^0x/,''); if(h.length<128)return null;
  try{return {amount0:signedWord(h.slice(0,64)),amount1:signedWord(h.slice(64,128))};}catch{return null;}
}
async function getPoolMeta(poolId, latestBlock){
  const rows=await explorerLogs({fromBlock:0,toBlock:latestBlock,topic0:V4_INITIALIZE_TOPIC,topic1:poolId});
  const row=rows[0], topics=row?.topics||[];
  if(!row||topics.length<4) throw new Error(`Pool metadata unavailable for ${poolId.slice(0,10)}…`);
  const c0=topicAddress(topics[2]), c1=topicAddress(topics[3]);
  const tokenIndex=c0===TOKEN?0:(c1===TOKEN?1:null);
  if(tokenIndex==null) throw new Error('TA token not found in v4 pool metadata');
  return {poolId,tokenIndex};
}
async function getBlockTimes(blockNums){
  const uniq=[...new Set(blockNums.filter(Boolean))]; const out=new Map();
  for(let i=0;i<uniq.length;i+=80){
    const chunk=uniq.slice(i,i+80);
    const payload=chunk.map((b,j)=>({jsonrpc:'2.0',id:j+1,method:'eth_getBlockByNumber',params:[`0x${b.toString(16)}`,false]}));
    const j=await rpc(payload,10000);
    if(!Array.isArray(j)) throw new Error('RPC block batch unavailable');
    for(const x of j){const b=parseBlockNumber(x?.result?.number),t=parseBlockNumber(x?.result?.timestamp);if(b!=null&&t!=null)out.set(b,new Date(t*1000));}
  }
  return out;
}
async function getTxOrigins(hashes){
  const uniq=[...new Set(hashes.filter(Boolean))]; const out=new Map();
  for(let i=0;i<uniq.length;i+=80){
    const chunk=uniq.slice(i,i+80);
    const payload=chunk.map((h,j)=>({jsonrpc:'2.0',id:j+1,method:'eth_getTransactionByHash',params:[h]}));
    const j=await rpc(payload,10000);
    if(!Array.isArray(j)) throw new Error('RPC transaction batch unavailable');
    for(const x of j){const h=String(x?.result?.hash||'').toLowerCase(),f=String(x?.result?.from||'').toLowerCase();if(h&&f)out.set(h,f);}
  }
  return out;
}
function logBlock(log){return parseBlockNumber(log?.blockNumber ?? log?.block_number);}
function logHash(log){return String(log?.transactionHash ?? log?.transaction_hash ?? '').toLowerCase();}

module.exports=async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({error:'Method not allowed'});
  try{
    const market=await getMarket();
    if(!market.poolIds.length) throw new Error('DEX Screener did not return a Uniswap v4 pool ID for TA');
    const [startBlock,latestBlock]=await Promise.all([getBlockAtTimestamp(rollingStartMs(30)),getLatestBlock()]);
    const metas=await Promise.all(market.poolIds.map(id=>getPoolMeta(id,latestBlock)));
    const logGroups=await Promise.all(metas.map(m=>logsComplete({fromBlock:startBlock,toBlock:latestBlock,topic0:V4_SWAP_TOPIC,topic1:m.poolId})));
    const raw=[];
    metas.forEach((meta,i)=>{
      for(const log of logGroups[i]){
        const d=decodeSwap(log?.data); const block=logBlock(log); const hash=logHash(log);
        if(!d||block==null||!hash)continue;
        const taRaw=meta.tokenIndex===0?d.amount0:d.amount1;
        if(taRaw===0n)continue;
        const amountTa=Number(taRaw<0n?-taRaw:taRaw)/1e18;
        if(!Number.isFinite(amountTa)||amountTa<=0)continue;
        // IPoolManager.swap returns the balance delta of the swapping address.
        // Positive TA delta = TA received by the swapper (buy); negative = TA sent (sell).
        raw.push({side:taRaw>0n?'buy':'sell',amountTa,block,hash});
      }
    });
    if(!raw.length) throw new Error('No TA v4 swaps returned in the last 30 days');
    const [times,origins]=await Promise.all([getBlockTimes(raw.map(x=>x.block)),getTxOrigins(raw.map(x=>x.hash))]);
    const rows=raw.map(x=>({...x,date:times.get(x.block)||null,wallet:origins.get(x.hash)||null})).filter(x=>x.date);
    const calc=(days)=>{
      const since=rollingStartMs(days); const xs=rows.filter(x=>x.date.getTime()>=since);
      const buyTa=xs.filter(x=>x.side==='buy').reduce((a,x)=>a+x.amountTa,0);
      const sellTa=xs.filter(x=>x.side==='sell').reduce((a,x)=>a+x.amountTa,0);
      let buyVolume=market.tokenPriceUsd!=null?buyTa*market.tokenPriceUsd:null;
      let sellVolume=market.tokenPriceUsd!=null?sellTa*market.tokenPriceUsd:null;
      let volume=buyVolume!=null&&sellVolume!=null?buyVolume+sellVolume:null;
      if(days===1 && market.volume24h!=null && volume>0){const scale=market.volume24h/volume;buyVolume*=scale;sellVolume*=scale;volume=market.volume24h;}
      return {buyVolume,sellVolume,uniqueWallets:new Set(xs.map(x=>x.wallet).filter(Boolean)).size,volume,swapCount:xs.length};
    };
    res.setHeader('Cache-Control','s-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ok:true,ranges:{'24h':calc(1),'7d':calc(7),'30d':calc(30)},note:'Buy/sell direction is derived from TA Uniswap v4 swaps. 24H buy/sell totals are scaled to the live DEX Screener total; 7D/30D use current TA/USD pricing.',walletNote:'Distinct originating wallets with TA buy or sell activity during this rolling period.',debug:{pools:metas.length,swapRows:rows.length,origins:origins.size},updatedAt:new Date().toISOString()});
  }catch(e){
    console.error('activity error',e);
    return res.status(200).json({ok:false,ranges:{'24h':{},'7d':{},'30d':{}},error:String(e?.message||e),updatedAt:new Date().toISOString()});
  }
};
