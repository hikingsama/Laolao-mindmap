'use strict';
// Local console controller. No shutdown endpoint is exposed to web pages.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net');
const crypto=require('node:crypto'),readline=require('node:readline'),{spawn}=require('node:child_process');
const PROTOCOL='mindmap-console-v1';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function identity(root,port){
  root=fs.realpathSync(root);if(process.platform==='win32')root=root.toLowerCase();
  const key=crypto.createHash('sha256').update(root+'|'+port).digest('hex').slice(0,32);
  return {root,port,pipe:process.platform==='win32'?'\\\\.\\pipe\\mindmap-console-'+key:path.join(os.tmpdir(),'mindmap-console-'+key+'.sock')};
}
function request(target,op='status',timeout=1500){
  return new Promise((resolve,reject)=>{
    const socket=net.connect(target.pipe);let data='',settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;socket.destroy();error?reject(error):resolve(value);};
    socket.setTimeout(timeout,()=>finish(Error('服务控制连接超时')));
    socket.on('error',error=>finish(error));socket.on('end',()=>{if(!settled)finish(Error('服务控制连接已关闭'));});
    socket.on('connect',()=>socket.write(JSON.stringify({protocol:PROTOCOL,root:target.root,port:target.port,op})+'\n'));
    socket.on('data',chunk=>{
      data+=chunk;if(data.length>8192)return finish(Error('服务控制响应无效'));
      if(!data.includes('\n'))return;
      try{const value=JSON.parse(data.slice(0,data.indexOf('\n')));if(value.protocol!==PROTOCOL || value.root!==target.root || value.port!==target.port)throw Error('服务身份不匹配');if(!value.ok)throw Error(value.error || '服务控制失败');finish(null,value);}catch(error){finish(error);}
    });
  });
}
function openBrowser(address){
  return new Promise((resolve,reject)=>{
    // The address contains only a fixed loopback host and a validated numeric port.
    const command=process.platform==='win32'?['cmd.exe',['/d','/s','/c','start "" "'+address+'"']]:process.platform==='darwin'?['open',[address]]:['xdg-open',[address]];
    const child=spawn(command[0],command[1],{cwd:os.tmpdir(),windowsHide:true,windowsVerbatimArguments:process.platform==='win32',stdio:'ignore'});
    child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('默认浏览器未能打开，请手动访问 '+address)));
  });
}
async function claim(target){
  const sockets=new Set();let phase='starting',stop=null;
  const control=net.createServer(socket=>{
    sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});socket.setTimeout(2000,()=>socket.destroy());let data='';
    socket.on('data',chunk=>{
      data+=chunk;if(data.length>4096)return socket.destroy();if(!data.includes('\n'))return;
      let value;try{value=JSON.parse(data.slice(0,data.indexOf('\n')));}catch{return socket.destroy();}
      if(value.protocol!==PROTOCOL || value.root!==target.root || value.port!==target.port || !['status','stop'].includes(value.op))return socket.destroy();
      socket.removeAllListeners('data');
      const answer={protocol:PROTOCOL,root:target.root,port:target.port,ok:true,pid:process.pid,phase};
      socket.end(JSON.stringify(answer)+'\n');
      if(value.op==='stop')socket.once('close',()=>{if(stop)void stop();});
    });
  });
  await new Promise((resolve,reject)=>{control.once('error',reject);control.listen(target.pipe,()=>{control.removeListener('error',reject);resolve();});});
  control.on('error',()=>{});
  return {setPhase:value=>phase=value,onStop:fn=>stop=fn,close:()=>new Promise(resolve=>{for(const socket of sockets)socket.destroy();control.close(resolve);})};
}
async function run({project=path.resolve(__dirname,'..'),input=process.stdin,output=process.stdout,openPage=openBrowser}={}){
  const port=Number(process.env.MM_PORT || 8796);if(!Number.isInteger(port)||port<1||port>65535){output.write('服务端口无效。\n');return 1;}
  const target=identity(project,port),address='http://127.0.0.1:'+port+'/';
  let owner=false,control=null,http=null,rl=null,poll=null,stopping=null,completed=false,processing=false,stopRequested=false,initializing=true,remoteStopping=false;
  let finish;const finished=new Promise(resolve=>finish=resolve);
  const say=message=>output.write(message+'\n');
  const done=code=>{if(completed)return;completed=true;if(poll)clearInterval(poll);rl?.close();finish(code);};
  async function stopOwned(){
    if(stopping)return stopping;
    stopping=(async()=>{
      control?.setPhase('stopping');say('正在停止服务…');
      if(http?.listening)await new Promise(resolve=>{
        let settled=false;const end=()=>{if(settled)return;settled=true;clearTimeout(timer);resolve();};
        const timer=setTimeout(()=>{http.closeAllConnections?.();end();},5000);
        http.close(end);http.closeIdleConnections?.();
      });
      await control?.close();say('服务已停止，窗口即将退出。');done(0);
    })();return stopping;
  }
  async function stopRemote(){if(remoteStopping)return;remoteStopping=true;try{await request(target,'stop');say('已发送停止请求，正在等待服务结束…');}catch(error){remoteStopping=false;say('停止请求失败：'+error.message);}}
  const interrupt=()=>{stopRequested=true;if(initializing)return;if(owner)void stopOwned();else void stopRemote();};
  process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt);
  try{
    let existing;
    try{existing=await request(target);}catch(error){if(!['ENOENT','ECONNREFUSED'].includes(error.code))throw error;}
    if(stopRequested){if(existing)await request(target,'stop');return 0;}
    if(!existing){
      try{control=await claim(target);owner=true;control.onStop(stopOwned);}catch(error){
        if(error.code!=='EADDRINUSE')throw error;
        existing=await request(target);
      }
      if(owner){
        process.env.MM_PORT=String(port);
        http=require(path.join(project,'server.js'));
        await new Promise((resolve,reject)=>{if(http.listening)return resolve();http.once('listening',resolve);http.once('error',reject);});
        if(stopRequested){await stopOwned();return await finished;}
        control.setPhase('running');say('\n服务已启动。');
      }
    }
    if(!owner){
      for(let i=0;existing.phase==='starting' && i<100;i++){await sleep(100);existing=await request(target);}
      if(existing.phase!=='running')throw Error('服务正在启动或停止，请稍后重试。');
      say('\n服务已在运行，本窗口可控制同一目录的服务。');
    }
    if(completed)return await finished;
    say('访问地址：'+address);say('停止前请先在网页中保存导图。');
    rl=readline.createInterface({input,output,terminal:!!input.isTTY});rl.on('SIGINT',interrupt);
    function menu(){if(completed || stopping || remoteStopping)return;say('\n[1] 打开导图');say('[2] 停止服务并退出');if(!owner)say('[0] 关闭此窗口，保持服务运行');output.write('请输入选项：');}
    rl.on('line',async line=>{
      if(processing || completed || remoteStopping)return;processing=true;
      try{
        const choice=line.trim();
        if(choice==='1'){await openPage(address);say('已请求使用默认浏览器打开导图。');}
        else if(choice==='2'){
          if(owner)await stopOwned();
          else await stopRemote();
        }else if(choice==='0' && !owner){say('原服务继续运行。');done(0);}
        else say('请输入菜单中的数字。');
      }catch(error){say('操作未完成：'+error.message);}finally{processing=false;menu();}
    });
    // Closing an owning console (including redirected EOF) must not leave a server behind.
    rl.on('close',()=>{if(!completed && !stopping){if(owner)void stopOwned();else done(0);}});
    if(!owner){let checking=false;poll=setInterval(async()=>{if(checking || completed)return;checking=true;try{await request(target);}catch{say('\n原服务已结束，窗口即将退出。');done(0);}finally{checking=false;}},500);}
    initializing=false;if(stopRequested)interrupt();
    menu();return await finished;
  }catch(error){
    completed=true;
    if(error.code==='EADDRINUSE')say('端口 '+port+' 已被其他程序、另一份项目或旧版服务占用。请先在原启动窗口停止它，再重新启动。本窗口不会结束身份不明的进程。');
    else say('无法启动或连接服务：'+error.message);
    if(owner){if(http?.listening)await new Promise(resolve=>http.close(resolve));await control?.close();}
    return 1;
  }finally{if(poll)clearInterval(poll);rl?.close();process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);}
}
module.exports={run,identity,request,openBrowser};
if(require.main===module)run().then(code=>process.exit(code),error=>{console.error('服务控制发生错误：'+error.message);process.exit(1);});
