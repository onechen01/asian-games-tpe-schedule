'use client';

import {useEffect,useState} from 'react';

const SHOW_AFTER_PX=480;

export default function BackToTop(){
 const [visible,setVisible]=useState(false);

 useEffect(()=>{
  const update=()=>{
   const next=window.scrollY>SHOW_AFTER_PX;
   setVisible(current=>current===next?current:next);
  };
  update();
  window.addEventListener('scroll',update,{passive:true});
  return ()=>window.removeEventListener('scroll',update);
 },[]);

 if(!visible)return null;
 return <button className="back-to-top" type="button" onClick={()=>window.scrollTo({top:0,behavior:'smooth'})}>↑ 回到最上方</button>;
}
