exports.createPDF=(pages=8)=>{
  const objects=[null,'<< /Type /Catalog /Pages 2 0 R >>','', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'],kids=[];
  for(let page=1;page<=pages;page++){
    const stream='BT /F1 18 Tf 40 740 Td (Linear algebra - Page '+page+') Tj /F1 12 Tf '+Array.from({length:31},(_,i)=>`0 -20 Td (${page===3&&i===5?'The eigenvalue is lambda.':'Calculus curvature lesson, line '+(i+1)+'.'}) Tj`).join(' ')+' ET';
    const id=objects.length;kids.push(id+' 0 R');objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id+1} 0 R >>`,`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  objects[2]=`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages} >>`;
  let output='%PDF-1.7\n',offsets=[0];for(let i=1;i<objects.length;i++){offsets.push(Buffer.byteLength(output));output+=`${i} 0 obj\n${objects[i]}\nendobj\n`;}
  const xref=Buffer.byteLength(output);output+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;return Buffer.from(output);
};
