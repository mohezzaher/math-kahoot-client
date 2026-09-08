import React, { useEffect, useRef } from 'react';

const MathText = ({ text }) => {
  const containerRef = useRef(null);

  useEffect(() => {
    if (window.MathJax && containerRef.current) {
      window.MathJax.typesetPromise([containerRef.current]).catch((err) => console.log(err));
    }
  }, [text]);

  return <span ref={containerRef}>{text}</span>;
};

export default MathText;