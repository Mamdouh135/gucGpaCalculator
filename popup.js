/**
 * GUC Transcript GPA Calculator - Popup Script
 * Handles settings and communication with content script
 */

document.addEventListener('DOMContentLoaded', async () => {
  const toggleEnabled = document.getElementById('toggle-enabled');
  const btnReset = document.getElementById('btn-reset');
  const btnOpenTranscript = document.getElementById('btn-open-transcript');
  const statusMessage = document.getElementById('status-message');

  // New elements for user courses and target GPA
  const coursesForm = document.getElementById('courses-form');
  const courseNameInput = document.getElementById('course-name');
  const courseCreditsInput = document.getElementById('course-credits');
  const coursesList = document.getElementById('courses-list');
  const targetGpaInput = document.getElementById('target-gpa');
  const btnCalcTarget = document.getElementById('btn-calc-target');
  const targetResult = document.getElementById('target-result');

  // Storage keys
  const USER_COURSES_KEY = 'userCourses';
  const USER_TARGET_GPA_KEY = 'userTargetGpa';

  // Load user courses and target GPA
  let userCourses = [];
  let userTargetGpa = '';
  loadUserCourses();
  loadUserTargetGpa();
  // --- User Courses Logic ---
  coursesForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = courseNameInput.value.trim();
    const credits = parseFloat(courseCreditsInput.value);
    if (!name || isNaN(credits) || credits <= 0) {
      showStatus('Enter valid course name and credits.', 'error');
      return;
    }
    userCourses.push({ name, credits });
    await chrome.storage.local.set({ [USER_COURSES_KEY]: userCourses });
    courseNameInput.value = '';
    courseCreditsInput.value = '';
    renderCoursesList();
  });

  function renderCoursesList() {
    coursesList.innerHTML = '';
    userCourses.forEach((course, idx) => {
      const li = document.createElement('li');
      li.textContent = `${course.name} (${course.credits} credits)`;
      li.style.display = 'flex';
      li.style.justifyContent = 'space-between';
      li.style.alignItems = 'center';
      li.style.gap = '8px';
      // Remove button
      const btnRemove = document.createElement('button');
      btnRemove.textContent = '✖';
      btnRemove.style.background = 'none';
      btnRemove.style.border = 'none';
      btnRemove.style.color = '#dc3545';
      btnRemove.style.cursor = 'pointer';
      btnRemove.style.fontSize = '14px';
      btnRemove.title = 'Remove course';
      btnRemove.onclick = async () => {
        userCourses.splice(idx, 1);
        await chrome.storage.local.set({ [USER_COURSES_KEY]: userCourses });
        renderCoursesList();
      };
      li.appendChild(btnRemove);
      coursesList.appendChild(li);
    });
  }

  async function loadUserCourses() {
    const storage = await chrome.storage.local.get([USER_COURSES_KEY]);
    userCourses = Array.isArray(storage[USER_COURSES_KEY]) ? storage[USER_COURSES_KEY] : [];
    renderCoursesList();
  }

  // --- Target GPA Logic ---
  btnCalcTarget.addEventListener('click', async () => {
    const target = parseFloat(targetGpaInput.value);
    if (isNaN(target) || target < 0.7 || target > 5.0) {
      showStatus('Enter a valid target GPA (0.7 - 5.0)', 'error');
      return;
    }
    userTargetGpa = target;
    await chrome.storage.local.set({ [USER_TARGET_GPA_KEY]: userTargetGpa });
    calculateRequiredAverageWithTranscript();
  });

  async function loadUserTargetGpa() {
    const storage = await chrome.storage.local.get([USER_TARGET_GPA_KEY]);
    userTargetGpa = storage[USER_TARGET_GPA_KEY] || '';
    if (userTargetGpa) targetGpaInput.value = userTargetGpa;
    calculateRequiredAverageWithTranscript();
  }

  // Request completed courses from content script and calculate required average
  // --- Grade Combination Suggestion Logic ---
  let gradeCombinations = [];
  let currentCombinationIndex = 0;

  async function calculateRequiredAverageWithTranscript() {
    if (!userTargetGpa) {
      targetResult.textContent = '';
      return;
    }
    // Get completed courses from the transcript (content script)
    let completedCourses = [];
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url && tab.url.includes('apps.guc.edu.eg')) {
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'getCompletedCourses' });
        completedCourses = response && response.completedCourses ? response.completedCourses : [];
      }
    } catch (e) {
      completedCourses = [];
    }

    const pendingCourses = userCourses;
    const completedCredits = completedCourses.reduce((sum, c) => sum + Number(c.creditHours), 0);
    const completedWeightedSum = completedCourses.reduce((sum, c) => sum + (Number(c.grade) * Number(c.creditHours)), 0);
    const pendingCredits = pendingCourses.reduce((sum, c) => sum + Number(c.credits), 0);

    if (pendingCredits === 0) {
      targetResult.innerHTML = '<span style="color:#d48806">No pending courses entered.</span>';
      return;
    }

    const totalCredits = completedCredits + pendingCredits;
    const targetWeightedSum = userTargetGpa * totalCredits;
    const requiredPendingWeightedSum = targetWeightedSum - completedWeightedSum;
    const requiredAvgGrade = requiredPendingWeightedSum / pendingCredits;

    // If required average is less than 0.7, not possible
    if (requiredAvgGrade < 0.7) {
      targetResult.innerHTML = `❌ Not possible: The best achievable grade is 0.7, but you would need an average of <b>${requiredAvgGrade.toFixed(2)}</b>.<br>`;
      return;
    }
    if (requiredAvgGrade > 5.0) {
      targetResult.innerHTML = `❌ Achieving a GPA of <b>${userTargetGpa}</b> is not possible.<br>Would require: <b>${requiredAvgGrade.toFixed(2)}</b> (above failing)`;
      return;
    }

    // Generate all possible grade combinations for pending courses
    gradeCombinations = generateGradeCombinations(pendingCourses, requiredPendingWeightedSum);
    currentCombinationIndex = 0;

    if (gradeCombinations.length === 0) {
      targetResult.innerHTML = `❌ No valid grade combinations found to achieve a GPA of <b>${userTargetGpa}</b> with your current courses.`;
      return;
    }

    showCurrentCombination();
    // Add button for more suggestions if more than one
    if (gradeCombinations.length > 1) {
      if (!document.getElementById('show-other-suggestions')) {
        const btn = document.createElement('button');
        btn.id = 'show-other-suggestions';
        btn.textContent = 'Show Other Suggestions';
        btn.className = 'btn btn-secondary';
        btn.style.marginTop = '8px';
        btn.onclick = () => {
          currentCombinationIndex = (currentCombinationIndex + 1) % gradeCombinations.length;
          showCurrentCombination();
        };
        targetResult.parentNode.appendChild(btn);
      }
    } else {
      const btn = document.getElementById('show-other-suggestions');
      if (btn) btn.remove();
    }
  }

  // Helper: Generate all possible grade combinations (brute force, GUC steps),
  // and return those that meet or exceed the target GPA (as close as possible, minimum sum of grades)
  function generateGradeCombinations(pendingCourses, requiredSum) {
    const gradeSteps = [0.7, 1.0, 1.3, 1.7, 2.0, 2.3, 2.7, 3.0, 3.3, 3.7, 5.0];
    const n = pendingCourses.length;
    const credits = pendingCourses.map(c => Number(c.credits));
    const combinations = [];
    const completedCourses = [];
    // Try all combinations for up to 4 courses
    function tryCombinations(idx, current) {
      if (idx === n) {
        // Calculate GPA for this combination
        let weightedSum = 0, totalCredits = 0;
        for (let i = 0; i < n; ++i) {
          weightedSum += current[i] * credits[i];
          totalCredits += credits[i];
        }
        // Add completed courses if available (from closure)
        if (window.completedCoursesForCombo) {
          for (const c of window.completedCoursesForCombo) {
            weightedSum += c.grade * c.creditHours;
            totalCredits += c.creditHours;
          }
        }
        const gpa = weightedSum / totalCredits;
        if (gpa >= userTargetGpa - 0.0001) {
          combinations.push({ grades: [...current], gpa: gpa, sum: current.reduce((a, b) => a + b, 0) });
        }
        return;
      }
      for (let g of gradeSteps) {
        current.push(g);
        tryCombinations(idx + 1, current);
        current.pop();
      }
    }
    if (n >= 1 && n <= 4) {
      // Pass completed courses for GPA calculation
      window.completedCoursesForCombo = (typeof completedCoursesForCombo !== 'undefined') ? completedCoursesForCombo : [];
      tryCombinations(0, []);
      delete window.completedCoursesForCombo;
      // Sort by GPA (closest to target) then by sum of grades (easiest)
      combinations.sort((a, b) => (a.gpa - b.gpa) || (a.sum - b.sum));
      // Only keep those with the minimum GPA >= target
      if (combinations.length > 0) {
        const minGPA = combinations[0].gpa;
        return combinations.filter(c => Math.abs(c.gpa - minGPA) < 0.01).map(c => c.grades);
      }
      return [];
    } else {
      // For more than 4 courses, just suggest equal grades (minimum that meets/exceeds target)
      let totalCredits = credits.reduce((a, b) => a + b, 0);
      let completedWeightedSum = 0, completedCredits = 0;
      if (window.completedCoursesForCombo) {
        for (const c of window.completedCoursesForCombo) {
          completedWeightedSum += c.grade * c.creditHours;
          completedCredits += c.creditHours;
        }
      }
      let needed = (userTargetGpa * (totalCredits + completedCredits) - completedWeightedSum) / totalCredits;
      // Snap to nearest valid grade step >= needed
      let valid = gradeSteps.filter(g => g >= needed);
      if (valid.length > 0 && valid[0] <= 5.0) {
        return [Array(n).fill(valid[0])];
      }
      // Show warning in UI
      setTimeout(() => {
        let warn = document.getElementById('combination-warning');
        if (!warn) {
          warn = document.createElement('div');
          warn.id = 'combination-warning';
          warn.style.color = '#d48806';
          warn.style.fontSize = '12px';
          warn.style.marginTop = '8px';
          warn.innerText = 'Only equal-grade suggestion is shown for 5 or more courses (for performance reasons).';
          if (targetResult && targetResult.parentNode) {
            targetResult.parentNode.appendChild(warn);
          }
        }
      }, 100);
      return [];
    }
  }

  function showCurrentCombination() {
    if (!gradeCombinations.length) return;
    const comb = gradeCombinations[currentCombinationIndex];
    let html = `<b>Possible grade combination:</b><br><ul style="margin:8px 0 0 0;">`;
    for (let i = 0; i < comb.length; ++i) {
      const num = comb[i];
      const letter = numericToLetterGrade(num);
      html += `<li>${userCourses[i].name}: <b>${num}</b> (${letter})</li>`;
    }
    html += '</ul>';
    html += `<div style="margin-top:6px;font-size:12px;color:#888;">Suggestion ${currentCombinationIndex + 1} of ${gradeCombinations.length}</div>`;
    targetResult.innerHTML = html;
  }

  // Numeric to letter grade conversion (GUC/European scale, lowest value for each letter)
  function numericToLetterGrade(grade) {
    if (grade === 0.7) return 'A+';
    if (grade === 1.0) return 'A';
    if (grade === 1.3) return 'A-';
    if (grade === 1.7) return 'B+';
    if (grade === 2.0) return 'B';
    if (grade === 2.3) return 'B-';
    if (grade === 2.7) return 'C+';
    if (grade === 3.0) return 'C';
    if (grade === 3.3) return 'C-';
    if (grade === 3.7) return 'D';
    return 'F';
  }

  // Load current state from storage
  const storage = await chrome.storage.local.get(['enabled']);
  toggleEnabled.checked = storage.enabled !== false;

  // Toggle extension enabled/disabled
  toggleEnabled.addEventListener('change', async () => {
    const enabled = toggleEnabled.checked;
    await chrome.storage.local.set({ enabled });

    // Send message to active tab
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url && tab.url.includes('apps.guc.edu.eg')) {
        await chrome.tabs.sendMessage(tab.id, { action: 'toggle', enabled });
        showStatus(enabled ? 'Extension enabled!' : 'Extension disabled', 'success');
      } else {
        showStatus('Settings saved. Reload the transcript page to apply.', 'warning');
      }
    } catch (error) {
      showStatus('Settings saved. Reload the transcript page to apply.', 'warning');
    }
  });

  // Reset all predictions
  btnReset.addEventListener('click', async () => {
    // Clear storage
    await chrome.storage.local.set({ predictedGrades: {} });

    // Try to send message to active tab
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url && tab.url.includes('apps.guc.edu.eg')) {
        await chrome.tabs.sendMessage(tab.id, { action: 'reset' });
        showStatus('All predictions cleared!', 'success');
      } else {
        showStatus('Predictions cleared. Refresh transcript to see changes.', 'success');
      }
    } catch (error) {
      showStatus('Predictions cleared from storage.', 'success');
    }
  });

  // Open transcript page
  btnOpenTranscript.addEventListener('click', async () => {
    await chrome.tabs.create({
      url: 'https://apps.guc.edu.eg/student_ext/Grade/Transcript_001.aspx'
    });
    window.close();
  });

  // Show status message
  function showStatus(message, type) {
    statusMessage.textContent = message;
    statusMessage.className = `status-message ${type}`;
    // Auto-hide after 3 seconds
    setTimeout(() => {
      statusMessage.className = 'status-message';
    }, 3000);
  }
});
