import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';

// API Keys
const NUTRITIONIX_APP_ID = '595ae8f9';
const NUTRITIONIX_APP_KEY = '6d64bd2d3f0c8b003a2210e394ad85c8';
const NUTRITIONIX_API_URL = 'https://trackapi.nutritionix.com/v2/natural/nutrients';
const TRANSLATE_API_URL = 'https://google-translator9.p.rapidapi.com/v2';
const TRANSLATE_API_KEY = '80c3da75f9msh30f52bf064b2ff9p169ca8jsnf7ef1b74df76';
const GEMINI_API_KEY = 'AIzaSyBfqmIQAeFUHOPP26I1Gt3jR_e_tHLzAXc';

function App() {
    const [ingredients, setIngredients] = useState([]);
    const [currentIngredient, setCurrentIngredient] = useState('');
    const [nutrition, setNutrition] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [translationCache, setTranslationCache] = useState({});
    const [recipe, setRecipe] = useState(null);
    const [isGeneratingRecipe, setIsGeneratingRecipe] = useState(false);
    const [recipeError, setRecipeError] = useState(null);
    const [showRecipeGenerator, setShowRecipeGenerator] = useState(false);

    const translateText = async (text) => {
        if (!text) return text;

        if (translationCache[text]) {
            return translationCache[text];
        }

        try {
            const response = await axios.post(
                TRANSLATE_API_URL,
                new URLSearchParams({
                    q: text,
                    target: 'en',
                    source: 'ru'
                }),
                {
                    headers: {
                        'content-type': 'application/x-www-form-urlencoded',
                        'Accept-Encoding': 'application/gzip',
                        'X-RapidAPI-Key': TRANSLATE_API_KEY,
                        'X-RapidAPI-Host': 'google-translator9.p.rapidapi.com'
                    }
                }
            );

            const translatedText = response.data.data.translations[0].translatedText;
            setTranslationCache(prev => ({ ...prev, [text]: translatedText }));
            return translatedText;
        } catch (err) {
            console.error('Translation error:', err);
            return text;
        }
    };

    const fetchNutritionData = async () => {
        if (ingredients.length === 0) {
            setNutrition({
                calories: 0,
                protein: 0,
                fat: 0,
                carbs: 0
            });
            setError(null);
            setShowRecipeGenerator(false);
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            // Сначала выполняем все переводы
            const ingredientsWithTranslation = await Promise.all(
                ingredients.map(async ing => {
                    if (ing.translatedName) return ing; // Уже переведено

                    const translated = await translateText(ing.name);
                    return {
                        ...ing,
                        translatedName: translated.toLowerCase()
                    };
                })
            );

            setIngredients(ingredientsWithTranslation);

            const query = ingredientsWithTranslation
                .map(ing => `${ing.amount}g ${ing.translatedName}`)
                .join(' and ');

            const response = await fetch(NUTRITIONIX_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-app-id': NUTRITIONIX_APP_ID,
                    'x-app-key': NUTRITIONIX_APP_KEY,
                    'x-remote-user-id': '0'
                },
                body: JSON.stringify({
                    query: query,
                    timezone: 'US/Eastern'
                })
            });

            if (!response.ok) throw new Error('Ошибка получения данных');

            const data = await response.json();
            const total = { calories: 0, protein: 0, fat: 0, carbs: 0 };

            const updatedIngredients = ingredientsWithTranslation.map(ing => {
                const matchedFood = data.foods.find(food =>
                    food.food_name.toLowerCase().includes(ing.translatedName) ||
                    ing.translatedName.includes(food.food_name.toLowerCase())
                );

                total.calories += matchedFood?.nf_calories || 0;
                total.protein += matchedFood?.nf_protein || 0;
                total.fat += matchedFood?.nf_total_fat || 0;
                total.carbs += matchedFood?.nf_total_carbohydrate || 0;

                return {
                    ...ing,
                    photoUrl: matchedFood?.photo?.thumb || null
                };
            });

            setIngredients(updatedIngredients);
            setNutrition(total);
            setShowRecipeGenerator(true);
        } catch (err) {
            setError(err.message || 'Ошибка при расчете питательной ценности');
            console.error('API Error:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const addIngredient = () => {
        if (!currentIngredient) return;

        const parts = currentIngredient.split(' ');
        const amount = parseFloat(parts[parts.length - 1]) || 100;
        const name = parts.slice(0, parts.length - 1).join(' ').trim();

        if (!name) return; // Защита от пустого названия

        setIngredients(prev => [...prev, {
            name,
            amount,
            displayName: `${name} ${amount}g`,
            translatedName: '', // Инициализируем пустым значением
            photoUrl: null
        }]);
        setCurrentIngredient('');
    };

    const removeIngredient = (index) => {
        const newIngredients = [...ingredients];
        newIngredients.splice(index, 1);
        setIngredients(newIngredients);

        // Сбрасываем nutrition, если удалили последний ингредиент
        if (newIngredients.length === 0) {
            setNutrition({
                calories: 0,
                protein: 0,
                fat: 0,
                carbs: 0
            });
        }
    };

    useEffect(() => {
        if (ingredients.length === 0) {
            setNutrition({
                calories: 0,
                protein: 0,
                fat: 0,
                carbs: 0
            });
            return;
        }

        const timer = setTimeout(() => {
            fetchNutritionData();
        }, 1000);

        return () => clearTimeout(timer);
    }, [ingredients.map(i => i.name + i.amount).join()]); // Зависимость от ключевых полей

    const generateRecipe = async () => {
        if (ingredients.length === 0) {
            setRecipeError('Добавьте хотя бы один продукт');
            return;
        }

        setIsGeneratingRecipe(true);
        setRecipeError(null);
        setRecipe(null);

        try {
            const ingredientsList = ingredients.map(ing => ing.displayName).join(', ');

            const response = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
                {
                    contents: [{
                        parts: [{
                            text: `Придумай рецепт блюда на русском языке, используя следующие ингредиенты: ${ingredientsList}. 
                                   Рецепт должен включать:
                                   1. Название блюда (выдели как заголовок)
                                   2. Необходимые ингредиенты с количествами (оформи как список)
                                   3. Пошаговый процесс приготовления (оформи как нумерованный список)
                                   4. Время приготовления (укажи в минутах)
                                   
                                   Ответ предоставь в формате Markdown`
                        }]
                    }],
                    generationConfig: {
                        temperature: 0.7,
                        topK: 40,
                        topP: 0.95
                    }
                },
                {
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }
            );

            const recipeText = response.data.candidates[0].content.parts[0].text;
            setRecipe(recipeText);
        } catch (err) {
            console.error('Ошибка генерации рецепта:', err);
            setRecipeError(`Не удалось сгенерировать рецепт: ${err.response?.data?.error?.message || err.message}`);
        } finally {
            setIsGeneratingRecipe(false);
        }
    };

    const renderRecipe = () => {
        if (!recipe) return null;

        // Простой парсинг Markdown для отображения
        const lines = recipe.split('\n');
        return (
            <div className="recipe-content">
                {lines.map((line, index) => {
                    if (line.startsWith('## ')) {
                        return <h3 key={index}>{line.replace('## ', '')}</h3>;
                    } else if (line.startsWith('* ')) {
                        return <li key={index}>{line.replace('* ', '')}</li>;
                    } else if (/^\d+\./.test(line)) {
                        return <li key={index}>{line.replace(/^\d+\./, '')}</li>;
                    } else if (line.trim() === '') {
                        return <br key={index} />;
                    } else {
                        return <p key={index}>{line}</p>;
                    }
                })}
            </div>
        );
    };

    return (
        <div className="App">
            <div className="container">
                <header className="header">
                    <h1 className="title">👨‍🍳 Шеф-Помощник</h1>
                    <p className="subtitle">Считайте калории и создавайте новые рецепты из ваших продуктов</p>
                </header>

                <main className="main-content">
                    <section className="card input-section">
                        <h2 className="section-title">Добавьте продукты</h2>
                        <div className="input-group">
                            <input
                                type="text"
                                value={currentIngredient}
                                onChange={(e) => setCurrentIngredient(e.target.value)}
                                placeholder="Например: куриная грудка 200"
                                onKeyPress={(e) => e.key === 'Enter' && addIngredient()}
                                className="input-field"
                            />
                            <button onClick={addIngredient} className="add-button">
                                <span>+</span> Добавить
                            </button>
                        </div>

                        {ingredients.length > 0 && (
                            <div className="ingredients-list">
                                {ingredients.map((ing, index) => (
                                    <div key={index} className="ingredient-item">
                                        {ing.photoUrl ? (
                                            <img
                                                src={ing.photoUrl}
                                                alt="🍴"
                                                className="ingredient-image"
                                                onError={(e) => {
                                                    e.target.onerror = null;
                                                    e.target.style.display = 'none';
                                                }}
                                            />
                                        ) : (
                                            <div className="ingredient-icon">🍴</div>
                                        )}
                                        <span className="ingredient-name">{ing.displayName}</span>
                                        <button
                                            onClick={() => removeIngredient(index)}
                                            className="remove-button"
                                            aria-label="Удалить"
                                        >
                                            &times;
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>

                    {showRecipeGenerator && ingredients.length > 0 && (
                        <section className="card recipe-generator">
                            <h2 className="section-title">🍳 Генератор рецептов</h2>
                            <button
                                onClick={generateRecipe}
                                className="generate-button"
                                disabled={isGeneratingRecipe}
                            >
                                {isGeneratingRecipe ? 'Генерация...' : 'Сгенерировать рецепт'}
                            </button>
                        </section>
                    )}

                    {isLoading && (
                        <div className="card loading-state">
                            <div className="loader"></div>
                            <p>Расчет питательной ценности...</p>
                        </div>
                    )}

                    {error && (
                        <div className="card error-state">
                            <p>⚠️ {error}</p>
                        </div>
                    )}

                    {(nutrition !== null) && (
                        <section className="card nutrition-section">
                            <h2 className="section-title">🍽️ Пищевая ценность</h2>
                            <div className="nutrition-grid">
                                <div className="nutrition-item calorie">
                                    <h3>Калории</h3>
                                    <p>{Math.round(nutrition.calories)} <span>kcal</span></p>
                                </div>
                                <div className="nutrition-item protein">
                                    <h3>Белки</h3>
                                    <p>{Math.round(nutrition.protein)} <span>g</span></p>
                                </div>
                                <div className="nutrition-item fat">
                                    <h3>Жиры</h3>
                                    <p>{Math.round(nutrition.fat)} <span>g</span></p>
                                </div>
                                <div className="nutrition-item carbs">
                                    <h3>Углеводы</h3>
                                    <p>{Math.round(nutrition.carbs)} <span>g</span></p>
                                </div>
                            </div>
                        </section>
                    )}

                    {isGeneratingRecipe && (
                        <div className="card loading-state">
                            <div className="loader"></div>
                            <p>Генерируем рецепт...</p>
                        </div>
                    )}

                    {recipeError && (
                        <div className="card error-state">
                            <p>⚠️ {recipeError}</p>
                        </div>
                    )}


                    {recipe && (
                        <section className="card recipe-section">
                            <h2 className="section-title">🍴 Ваш рецепт</h2>
                            {renderRecipe()}
                        </section>
                    )}
                </main>

                <footer className="footer">
                    <p className="footer-text">
                        Вводите продукты в формате: "название вес (в граммах)" (например: "яблоко 150" или "гречка 80")
                    </p>
                </footer>
            </div>
        </div>
    );
}

export default App;
