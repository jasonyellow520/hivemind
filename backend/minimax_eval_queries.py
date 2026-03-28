import asyncio
import sys
import os
import json

# Add the parent directory to the Python path to allow imports from backend.services
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from services.minimax_client import classify_intent, quick_answer, chat_with_context, synthesize_results

queries = [
    "Open google.com and search for the nearest Italian restaurant.",
    "Buy a new pair of running shoes, size 9, black color, on Amazon.",
    "Navigate to my bank's website and log in.",
    "Fill out this job application form with my resume details.",
    "Compare prices for the iPhone 15 Pro Max across different retailers.",
    "Book a flight from New York to London for next month.",
    "Play 'Bohemian Rhapsody' on YouTube.",
    "Download the latest quarterly report from the company website.",
    "Hello, how are you today?",
    "What's the weather like in Paris right now?",
    "Tell me a joke.",
    "What's your favorite color, as an AI?",
    "Can you explain quantum physics in simple terms?",
    "I'm feeling a bit bored, what should I do?",
    "Is my previous task completed?",
    "What's the current progress of the flight booking?",
    "Did you find any good deals for the running shoes?",
    "I need something.",
    "The thing is, it's complicated.",
    "Do that thing you do, but faster."
]

async def run_minimax_function_tests():
    print("--- Running MiniMax classify_intent tests with M2.7 ---")
    for i, query in enumerate(queries):
        print(f"\nQuery {i+1}/{len(queries)}: {query}")
        try:
            result = await classify_intent(query)
            print(f"classify_intent Result: {json.dumps(result, indent=2)}")
        except Exception as e:
            print(f"classify_intent Error: {e}")
    
    print("\n--- Running MiniMax quick_answer tests ---")
    chat_queries = [
        "How are you doing today?",
        "Tell me about the capital of France.",
        "What is your purpose?"
    ]
    for i, query in enumerate(chat_queries):
        print(f"\nQuery {i+1}/{len(chat_queries)}: {query}")
        try:
            result = await quick_answer(query)
            print(f"quick_answer Result: {result}")
        except Exception as e:
            print(f"quick_answer Error: {e}")

    print("\n--- Running MiniMax chat_with_context tests ---")
    context_queries = [
        {"message": "What is the current status?", "history": [{"direction": "inbound", "text": "Start task X"}], "status": "Task X is running."},
        {"message": "Any updates?", "history": [{"direction": "inbound", "text": "Find a restaurant"}], "status": "Searching for restaurants in your area."},
    ]
    for i, item in enumerate(context_queries):
        print(f"\nQuery {i+1}/{len(context_queries)}: {item['message']}")
        try:
            result = await chat_with_context(item['message'], conversation_history=item['history'], swarm_status=item['status'])
            print(f"chat_with_context Result: {result}")
        except Exception as e:
            print(f"chat_with_context Error: {e}")

    print("\n--- Running MiniMax synthesize_results tests ---")
    synthesize_data = [
        {"task": "Find best laptop deals", "outputs": "Agent 1 found Dell XPS. Agent 2 found HP Spectre.", "expected": "Laptops deals found: Dell XPS and HP Spectre."},
        {"task": "Summarize news articles", "outputs": "Article 1: ... Article 2: ...", "expected": "Summary of news articles provided."},
    ]
    for i, item in enumerate(synthesize_data):
        print(f"\nQuery {i+1}/{len(synthesize_data)}: {item['task']}")
        try:
            result = await synthesize_results(item['task'], item['outputs'])
            print(f"synthesize_results Result: {result}")
        except Exception as e:
            print(f"synthesize_results Error: {e}")

if __name__ == "__main__":
    asyncio.run(run_minimax_function_tests())
