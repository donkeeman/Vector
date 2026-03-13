const OFF_TOPIC_PATTERN =
  /^(?:ㅎㅇ+|하이+|안녕+|반가워+|야+|야\b|너 누구야|넌 누구야|누구야|누구세요|뭐해|뭐하냐|잘 지내|오늘 어때|심심해|배고파|졸려|날씨|이름 뭐야|이름이 뭐야)(?:[?？!.,\s]*)$/iu;

const TECHNICAL_SIGNAL_PATTERN =
  /(?:api|http|https|tcp|udp|ip|dns|sql|db|database|query|index|transaction|cache|thread|process|event loop|event-loop|node|javascript|typescript|python|java|rust|go|react|vue|docker|kubernetes|k8s|linux|unix|kernel|cpu|gpu|memory|heap|stack|queue|tree|graph|algorithm|data structure|big[\s-]?o|rag|embedding|vector|scalar|matrix|determinant|probability|logic|boolean|proof|compiler|parser|runtime|async|await|알고리즘|자료구조|네트워크|운영체제|시스템|메모리|힙|스택|큐|트리|그래프|복잡도|빅오|캐시|트랜잭션|인덱스|데이터베이스|쿼리|정규화|컴파일|런타임|타입|포인터|프로세스|스레드|비동기|동기|이벤트 루프|콜스택|마이크로태스크|임베딩|벡터|스칼라|행렬|행렬식|미분|적분|확률|논리|불리언|정규형|오토마타|문법|파서|컴파일러|인터프리터)/iu;

const QUESTION_SIGNAL_PATTERN =
  /[?？]$|(?:왜|어떻게|무엇|뭐|언제|어디|누구|what|why|how)\b|(?:설명|알려|말해|비교|정리|요약|차이|의미|원리|구조).*(?:해|해줘|해주세요|해봐|줘)$|(?:뭐야|뭔데|뭐지|뜻이 뭐야|정의가 뭐야|이란|란 뭐야|인가)$/iu;

export function isAllowedTechnicalQuestion(text) {
  const normalized = normalizeText(text);

  if (!normalized) {
    return false;
  }

  if (OFF_TOPIC_PATTERN.test(normalized)) {
    return false;
  }

  return QUESTION_SIGNAL_PATTERN.test(normalized) && TECHNICAL_SIGNAL_PATTERN.test(normalized);
}

function normalizeText(text) {
  return String(text ?? "").trim().replace(/\s+/gu, " ");
}
