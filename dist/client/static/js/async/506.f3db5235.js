(self.webpackChunkclient=self.webpackChunkclient||[]).push([["506"],{18956:function(e,t,i){"use strict";function a(e,t){e.accDescr&&t.setAccDescription?.(e.accDescr),e.accTitle&&t.setAccTitle?.(e.accTitle),e.title&&t.setDiagramTitle?.(e.title)}i.d(t,{A:function(){return a}}),(0,i("10346").eW)(a,"populateCommonDb")},22179:function(e,t,i){"use strict";i.r(t),i.d(t,{diagram:function(){return W}});var a=i("53541"),l=i("18956"),r=i("14854"),n=i("38546"),s=i("10346"),c=i("27250"),o=i("61977"),p=n.vZ.pie,d={sections:new Map,showData:!1,config:p},u=d.sections,g=d.showData,f=structuredClone(p),h=(0,s.eW)(()=>structuredClone(f),"getConfig"),x=(0,s.eW)(()=>{u=new Map,g=d.showData,(0,n.ZH)()},"clear"),m=(0,s.eW)(({label:e,value:t})=>{if(t<0)throw Error(`"${e}" has invalid value: ${t}. Negative values are not allowed in pie charts. All slice values must be >= 0.`);!u.has(e)&&(u.set(e,t),s.cM.debug(`added new section: ${e}, with value: ${t}`))},"addSection"),w=(0,s.eW)(()=>u,"getSections"),$=(0,s.eW)(e=>{g=e},"setShowData"),S=(0,s.eW)(()=>g,"getShowData"),T={getConfig:h,clear:x,setDiagramTitle:n.g2,getDiagramTitle:n.Kr,setAccTitle:n.GN,getAccTitle:n.eu,setAccDescription:n.U$,getAccDescription:n.Mx,addSection:m,getSections:w,setShowData:$,getShowData:S},v=(0,s.eW)((e,t)=>{(0,l.A)(e,t),t.setShowData(e.showData),e.sections.map(t.addSection)},"populateDb"),y={parse:(0,s.eW)(async e=>{let t=await (0,c.Qc)("pie",e);s.cM.debug(t),v(t,T)},"parse")},D=(0,s.eW)(e=>`
  .pieCircle{
    stroke: ${e.pieStrokeColor};
    stroke-width : ${e.pieStrokeWidth};
    opacity : ${e.pieOpacity};
  }
  .pieOuterCircle{
    stroke: ${e.pieOuterStrokeColor};
    stroke-width: ${e.pieOuterStrokeWidth};
    fill: none;
  }
  .pieTitleText {
    text-anchor: middle;
    font-size: ${e.pieTitleTextSize};
    fill: ${e.pieTitleTextColor};
    font-family: ${e.fontFamily};
  }
  .slice {
    font-family: ${e.fontFamily};
    fill: ${e.pieSectionTextColor};
    font-size:${e.pieSectionTextSize};
    // fill: white;
  }
  .legend text {
    fill: ${e.pieLegendTextColor};
    font-family: ${e.fontFamily};
    font-size: ${e.pieLegendTextSize};
  }
`,"getStyles"),C=(0,s.eW)(e=>{let t=[...e.values()].reduce((e,t)=>e+t,0),i=[...e.entries()].map(([e,t])=>({label:e,value:t})).filter(e=>e.value/t*100>=1).sort((e,t)=>t.value-e.value);return(0,o.ve8)().value(e=>e.value)(i)},"createPieArcs"),b=(0,s.eW)((e,t,i,l)=>{s.cM.debug("rendering pie chart\n"+e);let c=l.db,p=(0,n.nV)(),d=(0,r.Rb)(c.getConfig(),p.pie),u=(0,a.P)(t),g=u.append("g");g.attr("transform","translate(225,225)");let{themeVariables:f}=p,[h]=(0,r.VG)(f.pieOuterStrokeWidth);h??=2;let x=d.textPosition,m=185,w=(0,o.Nb1)().innerRadius(0).outerRadius(m),$=(0,o.Nb1)().innerRadius(m*x).outerRadius(m*x);g.append("circle").attr("cx",0).attr("cy",0).attr("r",m+h/2).attr("class","pieOuterCircle");let S=c.getSections(),T=C(S),v=[f.pie1,f.pie2,f.pie3,f.pie4,f.pie5,f.pie6,f.pie7,f.pie8,f.pie9,f.pie10,f.pie11,f.pie12],y=0;S.forEach(e=>{y+=e});let D=T.filter(e=>"0"!==(e.data.value/y*100).toFixed(0)),b=(0,o.PKp)(v);g.selectAll("mySlices").data(D).enter().append("path").attr("d",w).attr("fill",e=>b(e.data.label)).attr("class","pieCircle"),g.selectAll("mySlices").data(D).enter().append("text").text(e=>(e.data.value/y*100).toFixed(0)+"%").attr("transform",e=>"translate("+$.centroid(e)+")").style("text-anchor","middle").attr("class","slice"),g.append("text").text(c.getDiagramTitle()).attr("x",0).attr("y",-200).attr("class","pieTitleText");let W=[...S.entries()].map(([e,t])=>({label:e,value:t})),k=g.selectAll(".legend").data(W).enter().append("g").attr("class","legend").attr("transform",(e,t)=>{let i=22,a=22*W.length/2;return"translate(216,"+(t*i-a)+")"});k.append("rect").attr("width",18).attr("height",18).style("fill",e=>b(e.label)).style("stroke",e=>b(e.label)),k.append("text").attr("x",22).attr("y",14).text(e=>c.getShowData()?`${e.label} [${e.value}]`:e.label);let A=512+Math.max(...k.selectAll("text").nodes().map(e=>e?.getBoundingClientRect().width??0));u.attr("viewBox",`0 0 ${A} 450`),(0,n.v2)(u,450,A,d.useMaxWidth)},"draw"),W={parser:y,db:T,renderer:{draw:b},styles:D}}}]);