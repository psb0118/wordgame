const Game = (() => {
    let currentWord = "";
    let usedWords = new Set();
    let gameOver = false;

    let words = new Set();
    let wordsByFirstChar = new Map();

    function loadWords(wordList) {
        words.clear();
        wordsByFirstChar.clear();

        for (const rawWord of wordList) {
            const word = String(rawWord).trim();

            if (!word) continue;

            words.add(word);

            const firstChar = word.charAt(0);

            if (!wordsByFirstChar.has(firstChar)) {
                wordsByFirstChar.set(firstChar, []);
            }

            wordsByFirstChar.get(firstChar).push(word);
        }

        console.log("단어 로딩 완료:", words.size);
    }

    function normalizeWord(word) {
        return String(word || "").trim();
    }

    function hasWord(word) {
        return words.has(normalizeWord(word));
    }

    function getLastChar(word) {
        const chars = Array.from(word);
        return chars[chars.length - 1];
    }

    function getFirstChar(word) {
        return Array.from(word)[0];
    }

    function canConnect(previousWord, nextWord) {
        previousWord = normalizeWord(previousWord);
        nextWord = normalizeWord(nextWord);

        if (!previousWord || !nextWord) {
            return false;
        }

        const lastChar = getLastChar(previousWord);
        const firstChar = getFirstChar(nextWord);

        if (lastChar === firstChar) {
            return true;
        }

        // 기본 두음법칙 매핑
        const dueum = {
            라: ["나"],
            랴: ["야"],
            러: ["너"],
            려: ["여"],
            로: ["노"],
            료: ["요"],
            루: ["누"],
            류: ["유"],
            리: ["이"],
            례: ["예"],
            녀: ["여"],
            뇨: ["요"],
            뉴: ["유"],
            니: ["이"]
        };

        if (
            dueum[lastChar] &&
            dueum[lastChar].includes(firstChar)
        ) {
            return true;
        }

        return false;
    }

    function getCandidates(word) {
        word = normalizeWord(word);

        if (!word) return [];

        const lastChar = getLastChar(word);

        let candidates = [];

        if (wordsByFirstChar.has(lastChar)) {
            candidates = wordsByFirstChar.get(lastChar);
        }

        // 두음법칙 후보
        const dueum = {
            라: ["나"],
            랴: ["야"],
            러: ["너"],
            려: ["여"],
            로: ["노"],
            료: ["요"],
            루: ["누"],
            류: ["유"],
            리: ["이"],
            례: ["예"],
            녀: ["여"],
            뇨: ["요"],
            뉴: ["유"],
            니: ["이"]
        };

        if (dueum[lastChar]) {
            for (const char of dueum[lastChar]) {
                if (wordsByFirstChar.has(char)) {
                    candidates.push(
                        ...wordsByFirstChar.get(char)
                    );
                }
            }
        }

        return [...new Set(candidates)].filter(
            candidate => !usedWords.has(candidate)
        );
    }

    function setCurrentWord(word) {
        currentWord = normalizeWord(word);
        usedWords.add(currentWord);
    }

    function getCurrentWord() {
        return currentWord;
    }

    function isUsed(word) {
        return usedWords.has(normalizeWord(word));
    }

    function validateWord(word) {
        word = normalizeWord(word);

        if (gameOver) {
            return {
                valid: false,
                reason: "게임이 종료되었습니다."
            };
        }

        if (!word) {
            return {
                valid: false,
                reason: "단어를 입력해주세요."
            };
        }

        if (!hasWord(word)) {
            return {
                valid: false,
                reason: "존재하지 않는 단어입니다."
            };
        }

        if (isUsed(word)) {
            return {
                valid: false,
                reason: "이미 사용한 단어입니다."
            };
        }

        if (
            currentWord &&
            !canConnect(currentWord, word)
        ) {
            return {
                valid: false,
                reason: "현재 단어와 연결되지 않습니다."
            };
        }

        return {
            valid: true
        };
    }

    function playWord(word) {
        const result = validateWord(word);

        if (!result.valid) {
            return result;
        }

        setCurrentWord(word);

        return {
            valid: true,
            word: normalizeWord(word),
            candidates: getCandidates(word)
        };
    }

    function newGame(startWord = "") {
        currentWord = "";
        usedWords.clear();
        gameOver = false;

        if (startWord) {
            setCurrentWord(startWord);
        }
    }

    function endGame() {
        gameOver = true;
    }

    return {
        loadWords,
        hasWord,
        canConnect,
        getCandidates,
        getCurrentWord,
        validateWord,
        playWord,
        newGame,
        endGame
    };
})();
