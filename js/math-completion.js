/* Course-oriented templates and range-based tab stops. Browser and Node, no dependencies. */
(function(root) {
  const R = String.raw;
  const definitions = [];
  const add = (group, trigger, label, replacement, fields = []) => definitions.push({group,trigger,label,replacement,fields});
  const basic = (t,l,r,f) => add('基础结构',t,l,r,f);
  basic('frac','分数',R`\frac{□}{□}`,['分子','分母']);
  basic('sqrt','平方根',R`\sqrt{□}`,['被开方表达式']);
  basic('root','n 次根',R`\sqrt[□]{□}`,['根指数','被开方表达式']);
  basic('pow','幂',R`{□}^{□}`,['底数','指数']);
  basic('sub','下标',R`{□}_{□}`,['主体','下标']);
  basic('abs','绝对值',R`\left|□\right|`,['表达式']);
  basic('norm','范数',R`\left\lVert □\right\rVert`,['向量或表达式']);
  basic('binom','组合数',R`\binom{□}{□}`,['总数 n','选取数 k']);
  const elementary = (t,l,r,f) => add('初等函数',t,l,r,f);
  elementary('sin','正弦',R`\sin\left(□\right)`,['自变量表达式']);
  elementary('cos','余弦',R`\cos\left(□\right)`,['自变量表达式']);
  elementary('tan','正切',R`\tan\left(□\right)`,['自变量表达式']);
  elementary('arcsin','反正弦',R`\arcsin\left(□\right)`,['自变量表达式']);
  elementary('arccos','反余弦',R`\arccos\left(□\right)`,['自变量表达式']);
  elementary('arctan','反正切',R`\arctan\left(□\right)`,['自变量表达式']);
  elementary('ln','自然对数',R`\ln\left(□\right)`,['真数表达式']);
  elementary('log','任意底数对数',R`\log_{□}\left(□\right)`,['底数','真数表达式']);
  elementary('exp','自然指数函数',R`e^{□}`,['指数表达式']);
  const limit = (t,l,r,f) => add('极限与分段函数',t,l,r,f);
  limit('lim','极限',R`\lim_{□\to □} □`,['变量','趋近点','函数或表达式']);
  limit('liml','左极限',R`\lim_{□\to □^{-}} □`,['变量','趋近点','函数或表达式']);
  limit('limr','右极限',R`\lim_{□\to □^{+}} □`,['变量','趋近点','函数或表达式']);
  limit('liminf','无穷远极限',R`\lim_{□\to\infty} □`,['变量','函数或表达式']);
  limit('limninf','负无穷远极限',R`\lim_{□\to-\infty} □`,['变量','函数或表达式']);
  limit('lim2','二元函数极限',R`\lim_{(□,□)\to(□,□)} □`,['第一变量','第二变量','第一趋近坐标','第二趋近坐标','函数或表达式']);
  limit('limseq','数列极限',R`\lim_{□\to\infty} □`,['序号变量（如 n）','数列通项']);
  limit('cases2','两段分段函数',R`\begin{cases} □, & □ \\ □, & □ \end{cases}`,['第一段表达式','第一段条件','第二段表达式','第二段条件']);
  const derivative = (t,l,r,f) => add('导数与微分',t,l,r,f);
  derivative('der','一阶导数',R`\frac{\mathrm{d} □}{\mathrm{d} □}`,['函数或因变量','自变量']);
  derivative('nder','高阶导数记号',R`{□}^{(□)}(□)`,['函数名','导数阶数','自变量']);
  derivative('pder','偏导数',R`\frac{\partial □}{\partial □}`,['函数','求偏导的变量']);
  derivative('mixed','二阶混合偏导',R`\frac{\partial^2 □}{\partial □\,\partial □}`,['函数','第一变量','第二变量']);
  derivative('diff','微分元',R`\mathrm{d} □`,['微分变量']);
  derivative('grad','梯度',R`\nabla □`,['函数']);
  derivative('totald','二元函数全微分',R`\mathrm{d}z=\frac{\partial z}{\partial x}\mathrm{d}x+\frac{\partial z}{\partial y}\mathrm{d}y`);
  const integral = (t,l,r,f) => add('积分',t,l,r,f);
  integral('int','定积分',R`\int_{□}^{□} □\,\mathrm{d}□`,['下限','上限','被积函数','微分变量']);
  integral('dint','定积分（别名）',R`\int_{□}^{□} □\,\mathrm{d}□`,['下限','上限','被积函数','微分变量']);
  integral('uint','不定积分',R`\int □\,\mathrm{d}□`,['被积函数','微分变量']);
  integral('iint','二重积分',R`\iint_{□} □\,\mathrm{d}□\,\mathrm{d}□`,['积分区域','被积函数','第一微分变量','第二微分变量']);
  integral('iiint','三重积分',R`\iiint_{□} □\,\mathrm{d}□\,\mathrm{d}□\,\mathrm{d}□`,['积分区域','被积函数','第一微分变量','第二微分变量','第三微分变量']);
  integral('eval','代入上下限',R`\left.□\right|_{□}^{□}`,['原函数表达式','下限','上限']);
  const series = (t,l,r,f) => add('求和与级数',t,l,r,f);
  series('sum','有限求和',R`\sum_{□=□}^{□} □`,['求和指标','起始值','终止值','被求和项']);
  series('series','无穷级数',R`\sum_{□=□}^{\infty} □`,['求和指标','起始值','通项']);
  series('prod','连乘',R`\prod_{□=□}^{□} □`,['连乘指标','起始值','终止值','被乘项']);
  const formula = (t,l,r) => add('常用公式',t,l,r);
  formula('sinlim','重要极限：sin x / x',R`\lim_{x\to0}\frac{\sin x}{x}=1`);
  formula('explim','重要极限：自然常数 e',R`\lim_{x\to0}(1+x)^{1/x}=e`);
  formula('parts','分部积分',R`\int u\,\mathrm{d}v=uv-\int v\,\mathrm{d}u`);
  formula('ftc','牛顿—莱布尼茨公式',R`\int_a^b f(x)\,\mathrm{d}x=F(b)-F(a),\quad F'=f`);
  formula('taylor','泰勒公式（Peano 余项）',R`f(x)=\sum_{k=0}^{n}\frac{f^{(k)}(a)}{k!}(x-a)^k+o((x-a)^n)`);
  formula('geom','几何级数',R`\sum_{n=0}^{\infty}x^n=\frac{1}{1-x},\quad |x|<1`);
  formula('ode','一阶线性微分方程',R`y'+p(x)y=q(x)`);
  const algebra = (t,l,r,f) => add('矩阵与线性代数',t,l,r,f);
  algebra('mat2','2×2 矩阵',R`\begin{pmatrix} □ & □ \\ □ & □ \end{pmatrix}`,['第 1 行第 1 列','第 1 行第 2 列','第 2 行第 1 列','第 2 行第 2 列']);
  algebra('mat3','3×3 矩阵',R`\begin{pmatrix} □ & □ & □ \\ □ & □ & □ \\ □ & □ & □ \end{pmatrix}`,Array.from({length:9},(_,i)=>`第 ${Math.floor(i/3)+1} 行第 ${i%3+1} 列`));
  algebra('bmat2','方括号 2×2 矩阵',R`\begin{bmatrix} □ & □ \\ □ & □ \end{bmatrix}`,['a₁₁','a₁₂','a₂₁','a₂₂']);
  algebra('mat','一般矩阵',R`\begin{pmatrix} □ & \cdots & □ \\ \vdots & \ddots & \vdots \\ □ & \cdots & □ \end{pmatrix}`,['a₁₁','a₁ₙ','aₘ₁','aₘₙ']);
  algebra('det2','2 阶行列式',R`\begin{vmatrix} □ & □ \\ □ & □ \end{vmatrix}`,['a₁₁','a₁₂','a₂₁','a₂₂']);
  algebra('det3','3 阶行列式',R`\begin{vmatrix} □ & □ & □ \\ □ & □ & □ \\ □ & □ & □ \end{vmatrix}`,Array.from({length:9},(_,i)=>`第 ${Math.floor(i/3)+1} 行第 ${i%3+1} 列`));
  algebra('det','矩阵的行列式',R`\det\left(□\right)`,['矩阵']);
  algebra('vec2','二维列向量',R`\begin{pmatrix} □ \\ □ \end{pmatrix}`,['第一分量','第二分量']);
  algebra('vec3','三维列向量',R`\begin{pmatrix} □ \\ □ \\ □ \end{pmatrix}`,['第一分量','第二分量','第三分量']);
  algebra('vct','向量箭头记号',R`\vec{□}`,['向量名']);
  algebra('dot','内积',R`\left\langle □,□\right\rangle`,['第一个向量','第二个向量']);
  algebra('trans','转置',R`{□}^{\mathsf{T}}`,['矩阵或向量']);
  algebra('inv','逆矩阵',R`{□}^{-1}`,['矩阵']);
  algebra('rank','矩阵的秩',R`\operatorname{rank}\left(□\right)`,['矩阵']);
  algebra('solve','矩阵形式线性方程组',R`□\,□=□`,['系数矩阵 A','未知向量 x','常数向量 b']);
  algebra('sys2','二元线性方程组',R`\begin{cases} □x+□y=□ \\ □x+□y=□ \end{cases}`,['a₁₁','a₁₂','b₁','a₂₁','a₂₂','b₂']);
  algebra('aug2','两行增广矩阵',R`\left(\begin{array}{cc|c} □ & □ & □ \\ □ & □ & □ \end{array}\right)`,['a₁₁','a₁₂','b₁','a₂₁','a₂₂','b₂']);
  algebra('eig','特征值与特征向量',R`□\,□=□\,□`,['矩阵 A','特征向量 v','特征值 λ','同一特征向量 v（再次填写）']);
  algebra('charpoly','特征方程',R`\det\left(□-□ I\right)=0`,['矩阵 A','特征值变量 λ']);
  algebra('diag','对角矩阵',R`\operatorname{diag}(□,□,□)`,['第一对角元','第二对角元','第三对角元']);
  algebra('qform','二次型矩阵形式',R`{□}^{\mathsf{T}} □\,□`,['变量向量 x','对称矩阵 A','同一向量 x（再次填写）']);
  for (const [trigger,label,replacement] of [
    ['alpha','α',R`\alpha`],['beta','β',R`\beta`],['gamma','γ',R`\gamma`],['delta','δ',R`\delta`],['epsilon','ε',R`\varepsilon`],['lambda','λ',R`\lambda`],['mu','μ',R`\mu`],['theta','θ',R`\theta`],['pi','π',R`\pi`],['inf','无穷大',R`\infty`]
  ]) add('常用符号',trigger,label,replacement);
  const byTrigger = new Map();
  for (const row of definitions) {
    if (byTrigger.has(row.trigger) || (row.replacement.match(/□/g)||[]).length!==row.fields.length) throw new Error('Invalid completion definition: '+row.trigger);
    byTrigger.set(row.trigger,row);
  }
  function update(ta) {
    const state=ta._mmCompletion; if (!state || state.text===ta.value) return;
    const old=state.text, value=ta.value; let a=0, b=old.length, c=value.length;
    while(a<Math.min(b,c)&&old[a]===value[a]) a++;
    while(b>a&&c>a&&old[b-1]===value[c-1]) {b--;c--;}
    const delta=c-b;
    for(let i=0;i<state.stack.length;i++) {
      const session=state.stack[i], index=session.fields.findIndex(f=>a>=f.start&&b<=f.end);
      if(index>=0) {
        session.fields[index].end+=delta; session.active=index; session.end+=delta;
        for(let j=index+1;j<session.fields.length;j++) {session.fields[j].start+=delta;session.fields[j].end+=delta;}
      } else if(b<=session.start) {
        session.start+=delta;session.end+=delta;for(const f of session.fields){f.start+=delta;f.end+=delta;}
      } else if(a<session.end) {state.stack.splice(i);break;}
    }
    state.text=value;
  }
  function expand(ta,inMath) {
    update(ta);
    if(ta.selectionStart!==ta.selectionEnd||!inMath(ta.value,ta.selectionStart)) return false;
    const trigger=/(?:^|[^\\A-Za-z0-9])([A-Za-z][A-Za-z0-9]*)$/.exec(ta.value.slice(0,ta.selectionStart));
    const row=trigger&&byTrigger.get(trigger[1]);if(!row)return false;
    const start=ta.selectionStart-trigger[1].length;
    ta.setRangeText(row.replacement,start,ta.selectionStart,'end');update(ta);
    const state=ta._mmCompletion||(ta._mmCompletion={text:ta.value,stack:[]});state.text=ta.value;
    const fields=[];for(let i=0,j=0;i<row.replacement.length;i++) if(row.replacement[i]==='□') fields.push({start:start+i,end:start+i+1,label:row.fields[j++]});
    if(fields.length) {state.stack.push({start,end:start+row.replacement.length,fields,active:0,label:row.label});ta.setSelectionRange(fields[0].start,fields[0].end);}
    return true;
  }
  function handleTab(ta,backward,inMath) {
    update(ta);
    if(!backward&&expand(ta,inMath))return true;
    const state=ta._mmCompletion;
    while(state&&state.stack.length) {
      const s=state.stack[state.stack.length-1];
      if(ta.selectionStart<s.start||ta.selectionEnd>s.end) {state.stack.pop();continue;}
      const current=s.fields.findIndex(f=>ta.selectionStart>=f.start&&ta.selectionEnd<=f.end);
      let next=current>=0?current+(backward?-1:1):s.fields.findIndex(f=>f.start>=ta.selectionEnd);
      if(backward&&current<0) next=s.fields.findLastIndex(f=>f.end<=ta.selectionStart);
      if(backward&&next<0)next=0;
      if(next>=0&&next<s.fields.length){s.active=next;const f=s.fields[next];ta.setSelectionRange(f.start,f.end);return true;}
      state.stack.pop();ta.setSelectionRange(s.end,s.end);
      if(!state.stack.length)return true;
    }
    // Existing unfilled source still supports simple placeholder navigation on reopening.
    if(inMath(ta.value,ta.selectionStart)) {
      const slot=backward?ta.value.lastIndexOf('□',ta.selectionStart-1):ta.value.indexOf('□',ta.selectionEnd);
      if(slot>=0&&inMath(ta.value,slot)){ta.setSelectionRange(slot,slot+1);return true;}
    }
    return false;
  }
  function status(ta) {
    update(ta);const stack=ta._mmCompletion?.stack,s=stack?.[stack.length-1];if(!s)return null;
    const index=s.fields.findIndex(f=>ta.selectionStart>=f.start&&ta.selectionEnd<=f.end);
    return index<0?null:{label:s.label,field:s.fields[index].label,index:index+1,total:s.fields.length};
  }
  root.MMCompletion={definitions,update,expand,handleTab,status};
  if(typeof module!=='undefined')module.exports=root.MMCompletion;
})(typeof window!=='undefined'?window:globalThis);
