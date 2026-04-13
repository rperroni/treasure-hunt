import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js";
import { getFirestore, doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-storage.js";

const DATA_URL = "./missions.json";
const DB_NAME = "treasure-hunt-local-db";
const DB_VERSION = 1;
const PHOTO_STORE = "photos";
const MIN_TEAM_MEMBERS = 2;
const MAX_TEAM_MEMBERS = 6;
const APP_TITLE = "Búsqueda del Tesoro - De Ciudad Universitaria al Centro";
const DEFAULT_FINAL_ENCOUNTER_MESSAGE = "Punto de encuentro final: Plaza San Martín.";

const FIREBASE_CONFIG = {
    apiKey: "AIzaSyDdYdEd2-PgU9lCyFy4Sm5BKBW912182Zs",
    authDomain: "treasure-hunt-6addd.firebaseapp.com",
    projectId: "treasure-hunt-6addd",
    storageBucket: "treasure-hunt-6addd.firebasestorage.app",
    messagingSenderId: "1004785962367",
    appId: "1:1004785962367:web:d8658fbeb289346d299e4a",
    measurementId: "G-ZDRW8125R6"
};

const firebaseApp = initializeApp(FIREBASE_CONFIG);
const firestore = getFirestore(firebaseApp);
const storage = getStorage(firebaseApp);

const state = {
    dataset: null,
    teamCode: null,
    missions: [],
    progress: null,
    viewMissionIndex: 0,
    photoPreviewUrls: new Set(),
    cloudSyncStatus: "ready"
};

const introScreen = document.getElementById("introScreen");
const understoodButton = document.getElementById("understoodButton");
const loginScreen = document.getElementById("loginScreen");
const gameScreen = document.getElementById("gameScreen");
const finalEncounterScreen = document.getElementById("finalEncounterScreen");
const finalEncounterMessage = document.getElementById("finalEncounterMessage");
const teamCodeInput = document.getElementById("teamCodeInput");
const startButton = document.getElementById("startButton");
const statusMessage = document.getElementById("statusMessage");
const teamHeader = document.getElementById("teamHeader");
const missionsList = document.getElementById("missionsList");
const progressFill = document.getElementById("progressFill");
const progressMeta = document.getElementById("progressMeta");

const persistence = createPersistenceAdapter("local");

init();

async function init() {
    try {
        const response = await fetch(DATA_URL);
        if (!response.ok) {
            throw new Error("No se pudo cargar el archivo de misiones.");
        }

        state.dataset = await response.json();
        bindEvents();
        hydrateTeamFromQueryOrStorage();
    } catch (error) {
        setStatus(error.message || "Error al iniciar la app.", true);
    }
}

function bindEvents() {
    understoodButton.addEventListener("click", () => {
        introScreen.classList.add("hidden");
        loginScreen.classList.remove("hidden");
    });

    startButton.addEventListener("click", startGame);
    teamCodeInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            startGame();
        }
    });
}

function hydrateTeamFromQueryOrStorage() {
    const params = new URLSearchParams(window.location.search);
    const teamFromQuery = normalizeCode(params.get("team"));
    const lastTeam = normalizeCode(localStorage.getItem("lastTeamCode"));
    const teamCode = teamFromQuery || lastTeam;

    if (!teamCode || !state.dataset[teamCode]) {
        return;
    }

    teamCodeInput.value = teamCode;
    introScreen.classList.remove("hidden");
    loginScreen.classList.add("hidden");
}

function startGame() {
    const code = normalizeCode(teamCodeInput.value);
    const teamData = state.dataset[code];

    if (!teamData) {
        setStatus("Código inválido. Ejemplos: PUMA1, CONDOR2, HORNERO3, YAGUARETE4.", true);
        return;
    }

    state.teamCode = code;
    state.missions = buildMissionSet(teamData);
    state.progress = persistence.loadProgress(code);
    state.viewMissionIndex = Math.min(getCompletedCount(), Math.max(state.missions.length - 1, 0));

    localStorage.setItem("lastTeamCode", code);
    setStatus("");

    introScreen.classList.add("hidden");
    loginScreen.classList.add("hidden");
    gameScreen.classList.remove("hidden");
    finalEncounterScreen.classList.add("hidden");
    renderGame();
}

function buildMissionSet(teamData) {
    return teamData.missions.map((mission, index) => ({
        ...mission,
        index,
        order: index + 1
    }));
}

function createEmptyProgress() {
    return {
        startedAt: new Date().toISOString(),
        completedMissions: {},
        teamProfile: null,
        finalPuzzleAnswer: "",
        finalPuzzleSubmittedAt: null
    };
}

function saveProgress() {
    if (!state.teamCode || !state.progress) {
        return;
    }

    persistence.saveProgress(state.teamCode, state.progress);
}

async function syncMissionToCloud(mission, payload, photoFile) {
    const teamDocRef = doc(firestore, "teams", state.teamCode);
    const missionDocRef = doc(firestore, "teams", state.teamCode, "missions", mission.id);
    const photoPath = `${state.teamCode}/missions/${mission.id}/photo-${Date.now()}.jpg`;
    const photoRef = ref(storage, photoPath);
    const uploadResult = await uploadBytes(photoRef, photoFile);
    const photoUrl = await getDownloadURL(uploadResult.ref);

    await setDoc(teamDocRef, {
        teamCode: state.teamCode,
        displayName: state.dataset[state.teamCode].displayName,
        teamProfile: state.progress.teamProfile || null,
        lastMissionCompleted: mission.id,
        updatedAt: serverTimestamp()
    }, { merge: true });

    await setDoc(missionDocRef, {
        missionId: mission.id,
        order: mission.order,
        title: mission.title,
        triviaAnswer: payload.triviaAnswer,
        triviaAnswerLabel: payload.triviaAnswerLabel,
        teamProfile: payload.teamProfile || null,
        photoUrl,
        photoPath,
        completedAt: serverTimestamp()
    }, { merge: true });
}

async function syncFinalPuzzleToCloud(answer) {
    const teamDocRef = doc(firestore, "teams", state.teamCode);

    await setDoc(teamDocRef, {
        teamCode: state.teamCode,
        displayName: state.dataset[state.teamCode].displayName,
        teamProfile: state.progress.teamProfile || null,
        finalPuzzleAnswer: answer,
        finalPuzzleSubmittedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    }, { merge: true });
}

function progressKey(teamCode) {
    return `progress:${teamCode}`;
}

function normalizeCode(value) {
    const cleaned = (value || "")
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "");

    const withCollapsedNumber = cleaned.match(/^([A-ZÁÉÍÓÚÜÑ]+)0*([1-9]\d*)$/i);
    if (withCollapsedNumber) {
        return `${withCollapsedNumber[1].toUpperCase()}${withCollapsedNumber[2]}`;
    }

    return cleaned;
}

function setStatus(text, isError = false) {
    statusMessage.textContent = text;
    statusMessage.classList.toggle("error", isError);
}

async function renderGame() {
    disposePreviewUrls();

    const completedCount = getCompletedCount();
    const total = state.missions.length;
    const pct = total === 0 ? 0 : Math.round((completedCount / total) * 100);

    teamHeader.innerHTML = `
        <p><strong>${APP_TITLE}</strong></p>
        <p class="small">${state.dataset[state.teamCode].displayName}${formatTeamNameSuffix()}</p>
    `;

    progressFill.style.width = `${pct}%`;
    progressMeta.textContent = `${completedCount} / ${total} misiones completadas`;

    missionsList.innerHTML = "";

    if (completedCount >= total) {
        if (state.progress.finalPuzzleSubmittedAt) {
            renderFinalEncounterMessage();
        } else {
            gameScreen.classList.remove("hidden");
            finalEncounterScreen.classList.add("hidden");
            renderFinalPuzzleCard();
        }
        return;
    }

    gameScreen.classList.remove("hidden");
    finalEncounterScreen.classList.add("hidden");
    state.viewMissionIndex = clamp(state.viewMissionIndex, 0, completedCount);
    const mission = state.missions[state.viewMissionIndex];
    const card = await createMissionCard(mission, completedCount);
    card.id = `mission-card-${mission.id}`;
    missionsList.appendChild(card);
}

function getCompletedCount() {
    return Object.keys(state.progress.completedMissions).length;
}

async function createMissionCard(mission, completedCount) {
    const missionProgress = state.progress.completedMissions[mission.id];
    const isCompleted = Boolean(missionProgress);
    const isUnlocked = mission.index <= completedCount;

    const card = document.createElement("article");
    card.className = "mission-card";
    if (!isUnlocked) {
        card.classList.add("locked");
    }
    if (isCompleted) {
        card.classList.add("done");
    }

    const statusTag = isCompleted ? "Completada" : isUnlocked ? "Activa" : "Bloqueada";
    const missionTitle = formatMissionTitle(mission.title, mission.order);
    card.innerHTML = `
        <div class="mission-top">
            <h3>${mission.order}. ${missionTitle}</h3>
            <span class="tag">${statusTag}</span>
        </div>
        <p>${mission.clue}</p>
        <p class="extra-clue"><strong>Pista extra:</strong> ${mission.puzzleHint || "Sin pista extra"}</p>
    `;

    appendMissionNavigation(card, mission, completedCount);

    if (isCompleted) {
        const completeText = document.createElement("p");
        completeText.className = "small";
        completeText.textContent = `Respuesta guardada: ${missionProgress.triviaAnswerLabel || missionProgress.triviaAnswer}`;
        card.appendChild(completeText);

        if (missionProgress.teamProfile) {
            const teamData = document.createElement("p");
            teamData.className = "small";
            teamData.textContent = `Equipo: ${missionProgress.teamProfile.teamName} | Integrantes: ${missionProgress.teamProfile.members.join(", ")}`;
            card.appendChild(teamData);
        }

        if (missionProgress.photoKey) {
            const previewImage = await createSavedPhotoPreview(missionProgress.photoKey, `Foto ${mission.title}`);
            if (previewImage) {
                card.appendChild(previewImage);
            }
        }

        return card;
    }

    const form = document.createElement("form");
    form.noValidate = true;
    const formParts = [];

    if (mission.formType === "initial") {
        formParts.push(`
            <label for="team-name-${mission.id}">Nombre del equipo</label>
            <input id="team-name-${mission.id}" type="text" maxlength="50" required placeholder="Ej: Los Viajeros" autocomplete="off">

            <div id="members-container-${mission.id}" class="members-container"></div>
            <div class="member-actions">
                <button type="button" class="secondary add-member-button" id="add-member-${mission.id}">Agregar integrante</button>
                <button type="button" class="secondary remove-member-button" id="remove-member-${mission.id}">Quitar integrante</button>
            </div>
        `);
    }

    formParts.push(renderTriviaOptions(mission));
    formParts.push(`
        <label for="photo-${mission.id}">Subir foto del equipo</label>
        <input id="photo-${mission.id}" type="file" accept="image/*" capture="environment" required>
        <button type="submit">Completar misión</button>
    `);

    form.innerHTML = formParts.join("\n");

    if (mission.formType === "initial") {
        setupDynamicMembers(form, mission.id);
    }

    form.addEventListener("submit", async (event) => {
        event.preventDefault();

        const selectedTrivia = form.querySelector(`input[name='trivia-${mission.id}']:checked`);
        const photoEl = form.querySelector("input[type='file']");
        const triviaAnswer = selectedTrivia?.value || "";
        const triviaAnswerLabel = selectedTrivia?.dataset.label || "";
        const photoFile = photoEl.files?.[0] || null;

        if (!triviaAnswer || !photoFile) {
            window.alert("Para completar la misión, la trivia y la foto son obligatorias.");
            return;
        }

        let teamProfile = null;
        if (mission.formType === "initial") {
            const teamName = form.querySelector(`#team-name-${mission.id}`).value.trim();
            const members = Array.from(form.querySelectorAll(".member-input"))
                .map((input) => input.value.trim())
                .filter(Boolean);

            if (!teamName) {
                window.alert("Ingresen un nombre para el equipo.");
                return;
            }

            if (members.length < MIN_TEAM_MEMBERS) {
                window.alert("Necesitan al menos 2 integrantes para continuar.");
                return;
            }

            if (members.length > MAX_TEAM_MEMBERS) {
                window.alert("El máximo permitido es de 6 integrantes.");
                return;
            }

            teamProfile = { teamName, members };
        }

        const submitButton = form.querySelector("button[type='submit']");
        submitButton.disabled = true;
        try {
            const photoKey = `${state.teamCode}:${mission.id}`;
            await savePhoto(photoKey, photoFile);

            if (teamProfile) {
                state.progress.teamProfile = teamProfile;
            }

            state.progress.completedMissions[mission.id] = {
                triviaAnswer,
                triviaAnswerLabel,
                photoKey,
                teamProfile,
                completedAt: new Date().toISOString()
            };

            saveProgress();

            try {
                state.cloudSyncStatus = "syncing";
                await syncMissionToCloud(mission, {
                    triviaAnswer,
                    triviaAnswerLabel,
                    teamProfile
                }, photoFile);
                state.cloudSyncStatus = "synced";
            } catch (cloudError) {
                state.cloudSyncStatus = "local-only";
                console.warn("No se pudo sincronizar la misión con Firebase.", cloudError);
            }

            state.viewMissionIndex = Math.min(mission.index + 1, state.missions.length - 1);
            await renderGame();

            const nextMission = state.missions[mission.index + 1];
            if (nextMission) {
                scrollToMission(nextMission.id);
            }
        } catch (error) {
            window.alert(error.message || "No se pudo guardar la misión localmente.");
            submitButton.disabled = false;
        }
    });

    card.appendChild(form);
    return card;
}

function appendMissionNavigation(card, mission, completedCount) {
    const nav = document.createElement("div");
    nav.className = "mission-nav";

    if (mission.index > 0) {
        const backButton = document.createElement("button");
        backButton.type = "button";
        backButton.className = "secondary";
        backButton.textContent = "Volver a la anterior";
        backButton.addEventListener("click", async () => {
            state.viewMissionIndex = clamp(mission.index - 1, 0, completedCount);
            await renderGame();
        });
        nav.appendChild(backButton);
    }

    if (mission.index < completedCount) {
        const forwardButton = document.createElement("button");
        forwardButton.type = "button";
        forwardButton.className = "secondary";
        forwardButton.textContent = "Volver a la misión actual";
        forwardButton.addEventListener("click", async () => {
            state.viewMissionIndex = completedCount;
            await renderGame();
            const activeMission = state.missions[completedCount];
            if (activeMission) {
                scrollToMission(activeMission.id);
            }
        });
        nav.appendChild(forwardButton);
    }

    if (nav.childElementCount > 0) {
        card.appendChild(nav);
    }
}

function setupDynamicMembers(form, missionId) {
    const container = form.querySelector(`#members-container-${missionId}`);
    const addButton = form.querySelector(`#add-member-${missionId}`);
    const removeButton = form.querySelector(`#remove-member-${missionId}`);
    let memberCount = 0;

    const refreshMemberActionButtons = () => {
        addButton.disabled = memberCount >= MAX_TEAM_MEMBERS;
        removeButton.disabled = memberCount <= MIN_TEAM_MEMBERS;
    };

    const addMemberField = () => {
        if (memberCount >= MAX_TEAM_MEMBERS) {
            return;
        }

        memberCount += 1;
        const row = document.createElement("div");
        row.className = "member-row";

        const label = document.createElement("label");
        const isRequired = memberCount <= MIN_TEAM_MEMBERS;
        label.htmlFor = `member-${memberCount}-${missionId}`;
        label.textContent = isRequired ? `Integrante ${memberCount} *` : `Integrante ${memberCount}`;

        const input = document.createElement("input");
        input.id = `member-${memberCount}-${missionId}`;
        input.type = "text";
        input.maxLength = 60;
        input.placeholder = "Nombre y apellido";
        input.className = "member-input";
        input.required = isRequired;

        row.appendChild(label);
        row.appendChild(input);
        container.appendChild(row);
        refreshMemberActionButtons();
    };

    const removeMemberField = () => {
        if (memberCount <= MIN_TEAM_MEMBERS) {
            return;
        }

        const lastRow = container.lastElementChild;
        if (lastRow) {
            container.removeChild(lastRow);
            memberCount -= 1;
        }

        refreshMemberActionButtons();
    };

    addMemberField();
    addMemberField();
    refreshMemberActionButtons();

    addButton.addEventListener("click", addMemberField);
    removeButton.addEventListener("click", removeMemberField);
}

function formatMissionTitle(title, order) {
    const withoutPrefix = String(title || "")
        .replace(/^mision\s+\d+\s*[-:]\s*/i, "")
        .trim();

    if (!withoutPrefix) {
        return `Misión ${order}`;
    }

    return withoutPrefix;
}

function renderTriviaOptions(mission) {
    const trivia = mission.trivia || {};
    const options = Array.isArray(trivia.options) ? trivia.options : [];
    const questionText = trivia.question || "Selecciona una opción";

    const optionsHtml = options
        .map((option, index) => {
            const optionValue = `option-${index + 1}`;
            return `
                <label>
                    <input type="radio" name="trivia-${mission.id}" value="${optionValue}" data-label="${escapeHtmlAttribute(option)}" required>
                    ${option}
                </label>
            `;
        })
        .join("");

    return `
        <fieldset>
            <legend>${questionText}</legend>
            ${optionsHtml}
        </fieldset>
    `;
}

function formatTeamNameSuffix() {
    const teamName = state.progress?.teamProfile?.teamName;
    if (!teamName) {
        return "";
    }

    return ` | ${teamName}`;
}

function renderFinalPuzzleCard() {
    const teamData = state.dataset[state.teamCode];
    const currentAnswer = state.progress.finalPuzzleAnswer || "";

    const card = document.createElement("article");
    card.className = "mission-card done";
    card.innerHTML = `
        <div class="mission-top">
            <h3>Puzzle final</h3>
            <span class="tag">Final</span>
        </div>
        <p>${teamData.finalPuzzle?.prompt || "Ingresen la respuesta final del puzzle."}</p>
    `;

    const form = document.createElement("form");
    form.noValidate = true;
    form.innerHTML = `
        <label for="final-puzzle-answer">Respuesta final</label>
        <input id="final-puzzle-answer" type="text" maxlength="80" required placeholder="Escriban la palabra final" value="${escapeHtmlAttribute(currentAnswer)}">
        <button type="submit">Enviar</button>
    `;

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const answerInput = form.querySelector("#final-puzzle-answer");
        const answer = answerInput.value.trim();

        if (!answer) {
            window.alert("Ingresen una respuesta para el puzzle final.");
            return;
        }

        state.progress.finalPuzzleAnswer = answer;
        state.progress.finalPuzzleSubmittedAt = new Date().toISOString();
        saveProgress();

        try {
            state.cloudSyncStatus = "syncing";
            await syncFinalPuzzleToCloud(answer);
            state.cloudSyncStatus = "synced";
        } catch (cloudError) {
            state.cloudSyncStatus = "local-only";
            console.warn("No se pudo sincronizar el puzzle final con Firebase.", cloudError);
        }

        renderGame();
    });

    card.appendChild(form);
    missionsList.appendChild(card);
}

function renderFinalEncounterMessage() {
    const teamData = state.dataset[state.teamCode];
    missionsList.innerHTML = "";
    finalEncounterMessage.textContent = teamData.finalEncounterMessage || DEFAULT_FINAL_ENCOUNTER_MESSAGE;
    gameScreen.classList.add("hidden");
    finalEncounterScreen.classList.remove("hidden");
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function escapeHtmlAttribute(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("\"", "&quot;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}

function disposePreviewUrls() {
    for (const url of state.photoPreviewUrls) {
        URL.revokeObjectURL(url);
    }
    state.photoPreviewUrls.clear();
}

async function createSavedPhotoPreview(photoKey, altText) {
    const blob = await getPhoto(photoKey);
    if (!blob) {
        return null;
    }

    const image = document.createElement("img");
    const objectUrl = URL.createObjectURL(blob);
    state.photoPreviewUrls.add(objectUrl);
    image.src = objectUrl;
    image.alt = altText;
    image.className = "preview";
    return image;
}

function openDb() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(PHOTO_STORE)) {
                db.createObjectStore(PHOTO_STORE, { keyPath: "id" });
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new Error("No se pudo abrir IndexedDB."));
    });
}

async function savePhoto(id, blob) {
    const db = await openDb();

    return new Promise((resolve, reject) => {
        const tx = db.transaction(PHOTO_STORE, "readwrite");
        tx.objectStore(PHOTO_STORE).put({ id, blob, updatedAt: Date.now() });
        tx.oncomplete = () => {
            db.close();
            resolve();
        };
        tx.onerror = () => {
            db.close();
            reject(new Error("No se pudo guardar la foto localmente."));
        };
    });
}

async function getPhoto(id) {
    const db = await openDb();

    return new Promise((resolve, reject) => {
        const tx = db.transaction(PHOTO_STORE, "readonly");
        const request = tx.objectStore(PHOTO_STORE).get(id);

        request.onsuccess = () => {
            db.close();
            resolve(request.result?.blob || null);
        };

        request.onerror = () => {
            db.close();
            reject(new Error("No se pudo recuperar la foto local."));
        };
    });
}

function scrollToMission(missionId) {
    window.requestAnimationFrame(() => {
        const missionCard = document.getElementById(`mission-card-${missionId}`);
        if (!missionCard) {
            return;
        }

        missionCard.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    });
}

function createPersistenceAdapter(mode) {
    if (mode === "firebase") {
        return createFirebaseAdapter();
    }

    return createLocalAdapter();
}

function createLocalAdapter() {
    return {
        loadProgress(teamCode) {
            const raw = localStorage.getItem(progressKey(teamCode));
            if (!raw) {
                return createEmptyProgress();
            }

            try {
                const parsed = JSON.parse(raw);
                return {
                    startedAt: parsed.startedAt || new Date().toISOString(),
                    completedMissions: parsed.completedMissions || {},
                    teamProfile: parsed.teamProfile || null,
                    finalPuzzleAnswer: parsed.finalPuzzleAnswer || "",
                    finalPuzzleSubmittedAt: parsed.finalPuzzleSubmittedAt || null
                };
            } catch (_) {
                return createEmptyProgress();
            }
        },
        saveProgress(teamCode, progress) {
            localStorage.setItem(progressKey(teamCode), JSON.stringify(progress));
        },
        clearProgress(teamCode) {
            localStorage.removeItem(progressKey(teamCode));
        }
    };
}

function createFirebaseAdapter() {
    return createLocalAdapter();
}
