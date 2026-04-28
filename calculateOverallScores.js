function calculateOverallScores(data) {
    // Handle null/undefined data
    if (!data || !data.EvaluationDetails || !Array.isArray(data.EvaluationDetails)) {
      return {
        AvgLoadTime: data?.AvgLoadTime || 0,
        OverallCodeStructureScore: 0,
        OverallCSSScore: 0,
        OverallJavascriptScore: 0,
        TotalScore: 0
      };
    }

    const evaluationDetails = data.EvaluationDetails;
  
    // Group the scores by category (using actual category names from assessment files)
    const scoresByCategory = {
      CodeStructure: [],  // 'Code Structure & Cleanliness'
      CSS: [],            // 'CSS Expertise' and 'CSS Styling, Animations & Effects'
      JavaScript: []      // 'Java Script' (with or without trailing space)
    };

    // Collect scores for each category based on actual category names
    evaluationDetails.forEach(item => {
      const score = typeof item.score === 'number' ? item.score : 0;
      const category = (item.category || '').trim();
      
      if (category === 'Code Structure & Cleanliness') {
        const name = (item.name || '').trim();
        const maxScore = name === 'Concurrent Load Time' ? 10 : 20; // Load Time is 10, Responsiveness is 20
        scoresByCategory.CodeStructure.push({ score, maxScore });
      } else if (category === 'CSS Expertise' || category === 'CSS Styling, Animations & Effects') {
        scoresByCategory.CSS.push({ score, maxScore: 5 }); // CSS tests are 5 each
      } else if (category === 'Java Script' || category.trim() === 'Java Script') {
        scoresByCategory.JavaScript.push({ score, maxScore: 5 }); // JS tests are 5 each
      }
    });
  
  // Calculate the sum of actual scores and max possible scores for each category
  const codeStructureSum = scoresByCategory.CodeStructure.reduce((sum, item) => sum + item.score, 0);
  const codeStructureMax = scoresByCategory.CodeStructure.reduce((sum, item) => sum + item.maxScore, 0) || 1;
  
  const cssSum = scoresByCategory.CSS.reduce((sum, item) => sum + item.score, 0);
  const cssMax = scoresByCategory.CSS.reduce((sum, item) => sum + item.maxScore, 0) || 1;
  
  const javascriptSum = scoresByCategory.JavaScript.reduce((sum, item) => sum + item.score, 0);
  const javascriptMax = scoresByCategory.JavaScript.reduce((sum, item) => sum + item.maxScore, 0) || 1;
  
  // Calculate the overall scores according to the specified weights
  // Code Structure & Cleanliness: 30%
  const codeStructurePercentage = codeStructureSum / codeStructureMax;
  const overallCodeStructureScore = codeStructurePercentage * 30;
  
  // CSS Expertise: 40%
  const cssPercentage = cssSum / cssMax;
  const overallCSSScore = cssPercentage * 40;
  
  // JavaScript: 30%
  const javascriptPercentage = javascriptSum / javascriptMax;
  const overallJavaScriptScore = javascriptPercentage * 30;
  
  // Calculate the total score out of 100
  const totalScore = overallCodeStructureScore + overallCSSScore + overallJavaScriptScore;
  
  // Round all scores to 2 decimal places, return 0 for any NaN/null values
  const safeScore = (score) => {
    const parsed = parseFloat(score.toFixed(2));
    return isNaN(parsed) ? 0 : parsed;
  };

  return {
    AvgLoadTime: data.AvgLoadTime || 0,
    OverallCodeStructureScore: safeScore(overallCodeStructureScore),
    OverallCSSScore: safeScore(overallCSSScore),
    OverallJavascriptScore: safeScore(overallJavaScriptScore),
    TotalScore: safeScore(totalScore)
  };
  }
  
  module.exports = { calculateOverallScores };