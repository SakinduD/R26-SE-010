#!/usr/bin/env python
"""
Quick test script to verify the session recommendations endpoint works
Usage: python test_endpoint.py <session_id>
Example: python test_endpoint.py a1b2c3d4-e5f6-4a5b-9c8d-1e2f3a4b5c6d
"""

import sys
import requests
import json

BASE_URL = "http://localhost:8000/api/v1/analytics"

def test_session_recommendations(session_id):
    """Test the session recommendations endpoint"""
    url = f"{BASE_URL}/sessions/{session_id}/mentoring-recommendations"
    
    print(f"\n{'='*60}")
    print(f"Testing Session Recommendations Endpoint")
    print(f"{'='*60}")
    print(f"URL: {url}")
    print(f"Method: GET")
    
    try:
        print(f"\nSending request...")
        response = requests.get(url, timeout=10)
        
        print(f"Status Code: {response.status_code}")
        print(f"Headers: {dict(response.headers)}\n")
        
        if response.status_code == 200:
            data = response.json()
            print(f"✅ SUCCESS!\n")
            print(f"Response:")
            print(json.dumps(data, indent=2, default=str))
            
            print(f"\n{'='*60}")
            print(f"Summary:")
            print(f"  • User ID: {data.get('user_id')}")
            print(f"  • Session ID: {data.get('session_id')}")
            print(f"  • Recommendations: {len(data.get('recommendations', []))}")
            print(f"  • Source: {data.get('source')}")
            print(f"  • Type: {data.get('recommendation_type')}")
            print(f"{'='*60}\n")
            
            return True
        else:
            print(f"❌ ERROR!\n")
            print(f"Response Body:")
            print(json.dumps(response.json(), indent=2))
            return False
            
    except requests.exceptions.ConnectionError:
        print(f"❌ Connection Error!")
        print(f"Backend not running at {BASE_URL}")
        print(f"\nMake sure to start the backend with:")
        print(f"  cd Backend")
        print(f"  python -m uvicorn app.main:app --reload --port 8000")
        return False
    except Exception as e:
        print(f"❌ Error: {str(e)}")
        return False

def get_sessions_from_db():
    """Try to get sessions from the database"""
    print(f"\n{'='*60}")
    print(f"Attempting to get sessions from database...")
    print(f"{'='*60}\n")
    
    try:
        from app.db.database import SessionLocal
        from app.models.session_result import SessionResult
        
        db = SessionLocal()
        sessions = db.query(SessionResult).limit(5).all()
        
        if sessions:
            print(f"Found {len(sessions)} sessions:\n")
            for i, session in enumerate(sessions, 1):
                print(f"{i}. ID: {session.id}")
                print(f"   User: {session.user_id}")
                print(f"   Started: {session.started_at}\n")
            
            db.close()
            return sessions[0].id if sessions else None
        else:
            print("No sessions found in database")
            db.close()
            return None
            
    except Exception as e:
        print(f"Could not query database: {str(e)}")
        return None

if __name__ == "__main__":
    # Get session_id from command line or database
    if len(sys.argv) > 1:
        session_id = sys.argv[1]
    else:
        # Try to get from database
        session_id = get_sessions_from_db()
        if not session_id:
            print("\n❌ No session ID provided and couldn't get from database")
            print("Usage: python test_endpoint.py <session_id>")
            sys.exit(1)
    
    # Test the endpoint
    success = test_session_recommendations(session_id)
    sys.exit(0 if success else 1)
