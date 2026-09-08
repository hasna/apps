import {test,expect} from "bun:test";
import {awaitChannelDelivery} from "./channel-delivery.js";
import {registerChannelBridge,setSessionAgent} from "./channel.js";

test("aborted transport wait never becomes a delivered checkpoint after late settlement",async()=>{
  const abort=new AbortController();let finish!:()=>void;
  const pending=awaitChannelDelivery(()=>new Promise<void>(resolve=>{finish=resolve;}),abort.signal);
  await Promise.resolve();abort.abort();
  await expect(pending).rejects.toThrow("stopped");
  finish();await Promise.resolve();
  await expect(pending).rejects.toThrow("stopped");
});

test("channel bridge stop drains blocked notification without marking direct message read",async()=>{
  let attempted=0,marked=0;
  const server:any={server:{registerCapabilities(){},notification:async()=>{attempted++;await new Promise<void>(()=>{});}}};
  setSessionAgent(server,"fixture-agent","fixture-session");
  const store:any={
    readMessages:async(options:any)=>options.to==="session:fixture-session"?[{id:1,content:"fixture",from_agent:"other",session_id:"fixture-session"}]:[],
    readChannelNotifications:async()=>({notifications:[]}),
    markReadByIds:async()=>{marked++;},
  };
  const stop=registerChannelBridge(server,{store,startDelayMs:0,pollIntervalMs:5});
  try{
    const deadline=Date.now()+1000;
    while(attempted===0 && Date.now()<deadline)await Bun.sleep(5);
    expect(attempted).toBe(1);
    const outcome=await Promise.race([stop().then(()=>"stopped"),Bun.sleep(500).then(()=>"timeout")]);
    expect(outcome).toBe("stopped");expect(marked).toBe(0);
    await Bun.sleep(20);expect(attempted).toBe(1);
  }finally{await stop();}
});
